"""Coverage for the documented CORS/Origin gap (see docs/deployment.md,
"Same-origin URLs and CORS"):

- ``/ws/stream`` performs no Origin check at all — any Origin (or none) is
  accepted. This is an accepted-for-the-hackathon gap, not a bug: these
  tests confirm the *documented* behavior stays true, so a future change
  that quietly starts enforcing (or accidentally breaks) it gets noticed.
- ``CORS_ORIGINS`` (via Starlette's ``CORSMiddleware``) does restrict plain
  HTTP endpoints: a disallowed Origin gets no CORS grant, so a browser
  would block the cross-origin read even though the server still answers
  the request itself.
"""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.main import app

# The app is built with the default CORS_ORIGINS ("http://localhost:3000")
# since no override is set for the test process/environment.
ALLOWED_ORIGIN = "http://localhost:3000"
FOREIGN_ORIGIN = "http://evil.example"


class WebSocketOriginTests(unittest.TestCase):
    def test_ws_stream_accepts_an_arbitrary_foreign_origin(self) -> None:
        """/ws/stream does not check Origin at all: a foreign Origin header
        still gets a normal accept + idle status, per docs/deployment.md."""
        with TestClient(app) as client:
            with client.websocket_connect(
                "/ws/stream", headers={"origin": FOREIGN_ORIGIN}
            ) as websocket:
                self.assertEqual(websocket.receive_json(), {"type": "status", "state": "idle"})

    def test_ws_stream_accepts_no_origin_header_at_all(self) -> None:
        """A frame with no Origin header (e.g. a non-browser client) is
        likewise accepted, since there is no Origin enforcement to trigger."""
        with TestClient(app) as client:
            with client.websocket_connect("/ws/stream") as websocket:
                self.assertEqual(websocket.receive_json(), {"type": "status", "state": "idle"})


class HttpCorsRestrictionTests(unittest.TestCase):
    def test_preflight_from_allowed_origin_is_granted(self) -> None:
        with TestClient(app) as client:
            response = client.options(
                "/api/health",
                headers={"origin": ALLOWED_ORIGIN, "access-control-request-method": "GET"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN)

    def test_preflight_from_a_foreign_origin_is_rejected(self) -> None:
        """CORS_ORIGINS actually restricts plain HTTP endpoints: a disallowed
        Origin fails the CORSMiddleware preflight check (400, no
        Access-Control-Allow-Origin grant), unlike the websocket route above."""
        with TestClient(app) as client:
            response = client.options(
                "/api/health",
                headers={"origin": FOREIGN_ORIGIN, "access-control-request-method": "GET"},
            )
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(response.headers.get("access-control-allow-origin"))

    def test_simple_get_from_a_foreign_origin_gets_no_cors_grant(self) -> None:
        """The server still answers a simple cross-origin GET (CORS is
        enforced by the browser, not the server), but omits the
        Access-Control-Allow-Origin header for a disallowed origin, so a
        browser would block the frontend JS from reading the response."""
        with TestClient(app) as client:
            allowed = client.get("/api/health", headers={"origin": ALLOWED_ORIGIN})
            foreign = client.get("/api/health", headers={"origin": FOREIGN_ORIGIN})

        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN)
        self.assertEqual(foreign.status_code, 200)  # Server-side, the request still succeeds.
        self.assertIsNone(foreign.headers.get("access-control-allow-origin"))


if __name__ == "__main__":
    unittest.main()
