"""Regression coverage for malformed input, cancellation and wire guarantees."""

import asyncio
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from app.checkpoints import next_checkpoint
from app.main import app, ws_stream
from app.qwen_stream import _env_float, run_qwen_stream


class MessageTests(unittest.TestCase):
    def test_invalid_frames_leave_socket_usable(self):
        with TestClient(app) as client, client.websocket_connect('/ws/stream') as ws:
            ws.receive_json()
            for payload in ['{', 'null', '[]', '{"type":"clamp","value":2}',
                            '{"type":"start","prompt":" ","model":"qwen2.5-7b"}',
                            '{"type":"unknown"}']:
                ws.send_text(payload)
                self.assertEqual(ws.receive_json()['state'], 'error')
            ws.send_bytes(b'{}')
            self.assertEqual(ws.receive_json()['state'], 'error')
            ws.send_json({'type': 'stop'})
            self.assertEqual(ws.receive_json(), {'type': 'status', 'state': 'idle'})

    def test_unknown_feature_is_rejected_without_disconnect(self):
        with TestClient(app) as client, client.websocket_connect('/ws/stream') as ws:
            ws.receive_json()
            ws.send_json({'type': 'clamp', 'feature_id': 'missing', 'value': 0.5})
            event = ws.receive_json()
            self.assertEqual(event, {'type': 'status', 'state': 'error',
                                    'message': 'Activation steering is not connected yet'})


class StreamRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_malformed_upstream_shapes_send_terminal_error(self):
        for payload in [None, [], {'choices': [None]}, {'choices': [{'delta': None}]}]:
            with self.subTest(payload=payload):
                events = []

                async def send(event):
                    events.append(event)

                transport = httpx.MockTransport(lambda _: httpx.Response(
                    200, text=f'data: {json.dumps(payload)}\n\ndata: [DONE]\n\n'))
                async with httpx.AsyncClient(transport=transport) as client:
                    await run_qwen_stream('hello', send, pace=False, client=client)
                self.assertEqual(events[-1]['state'], 'error')
                self.assertNotIn(None, events[-1].values())

    async def test_disconnect_retrieves_already_failed_sender(self):
        started = asyncio.Event()
        task = None

        async def failed_run(*args, **kwargs):
            nonlocal task
            task = asyncio.current_task()
            started.set()
            raise WebSocketDisconnect(1006)

        class Socket:
            first = True

            async def accept(self):
                pass

            async def send_json(self, payload):
                pass

            async def receive_json(self):
                if self.first:
                    self.first = False
                    return {'type': 'start', 'prompt': 'hello', 'model': 'qwen2.5-7b'}
                await started.wait()
                raise WebSocketDisconnect(1006)

        with patch('app.main.run_qwen_stream', failed_run):
            await ws_stream(Socket())
        self.assertTrue(task.done())
        # A completed task must be awaited too, or asyncio logs an unretrieved error.
        self.assertFalse(task._log_traceback)

    async def test_receive_failure_still_cancels_generation(self):
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def running(*args, **kwargs):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        class Socket:
            first = True

            async def accept(self):
                pass

            async def send_json(self, payload):
                if payload.get('state') == 'error':
                    raise OSError('transport closed')

            async def receive_json(self):
                if self.first:
                    self.first = False
                    return {'type': 'start', 'prompt': 'hello', 'model': 'qwen2.5-7b'}
                await started.wait()
                raise OSError('transport closed')

        with patch('app.main.run_qwen_stream', running):
            with self.assertRaises(OSError):
                await ws_stream(Socket())
            self.assertTrue(cancelled.is_set())


class CheckpointRegressionTests(unittest.TestCase):
    def test_lead_word_boundary_with_repeated_words_and_whitespace(self):
        answer = '1. A          a a a a a a a a a a a'
        checkpoint = next_checkpoint(answer, set(), -1)
        self.assertIsNotNone(checkpoint)
        self.assertEqual(answer[:checkpoint.sample_end].split(), ['1.', 'A'] + ['a'] * 7)

    def test_tuning_rejects_nonfinite_and_negative_values(self):
        for value in ['nan', 'inf', '-inf', '-1', 'not-a-number']:
            with self.subTest(value=value), patch.dict('os.environ', {'AV_HOLD_TIMEOUT': value}):
                self.assertEqual(_env_float('AV_HOLD_TIMEOUT', 4.0), 4.0)


class PodLauncherTests(unittest.TestCase):
    def check_guard(self, name, boundary, secrets):
        # Only run the configuration preamble. Never execute Pod kill/start
        # commands, load a model, or read real credentials on the test host.
        script = (Path(__file__).parents[1] / 'pod' / name).read_text()
        preamble, separator, _ = script.partition(boundary)
        self.assertTrue(separator)
        with tempfile.TemporaryDirectory() as directory:
            if secrets is not None:
                (Path(directory) / 'secrets.env').write_text(secrets)
            preamble = preamble.replace('/workspace/hackgt', directory)
            result = subprocess.run(['bash', '-c', preamble + '\necho WOULD_LAUNCH'],
                                    capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('WOULD_LAUNCH', result.stdout)

    def test_restart_fails_before_killing_processes_when_secret_file_is_missing(self):
        self.check_guard('restart_sidecar.sh', '\nfor pid', None)

    def test_public_launchers_reject_empty_keys(self):
        for name, boundary in [('start_services.sh', '\nlistening()'),
                               ('restart_sidecar.sh', '\nfor pid')]:
            with self.subTest(script=name):
                self.check_guard(name, boundary, 'QWEN_API_KEY=\nAV_API_KEY=\n')
