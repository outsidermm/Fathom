# Token cost of steering vs. asking again

43 live cases from 20 prompts on Qwen2.5-7B-Instruct (greedy, HF sidecar, same model for every arm). Every number and text below came from the live Pod; see apps/api/scripts/steer_tokens.py for the method.

**Result:** Steering from a checkpoint used 46% fewer generated tokens than re-prompting (median, 16 paired successes). The saving is credited to **checkpoint branching (with the anchored opening)**: steered reached the target in 49% of cases vs 44% for the anchor alone and 37% for prefix + instruction.

## Arms

| arm | what it does | reached target | ended within cap | median generated tokens | median prefill tokens | median seconds |
|---|---|---|---|---|---|---|
| S steered | production steer from the checkpoint (block-20 contrast, anchored opening, loop guard) | 21/43 | 25/43 | 388 | 343 | 22 s |
| A anchor only | same prefix + same anchored opening, no steer | 19/43 | 22/43 | 397 | 115 | 9.2 s |
| P prefix + instruction | same prefix, request added to the prompt, no opening, no steer | 16/43 | 20/43 | 400 | 159 | 9.3 s |
| R re-prompt | request added to the prompt, whole answer regenerated | 22/43 | 22/43 | 435 | 56 | 10 s |

Reached target: the blind judge says `full` and the arm ended on its own within its cap (R: prefix tokens + 400; others: 400). R is judged on its whole answer, the others on the new section only, which favours R. Generated tokens run to the end of the answer for every arm: a branch rewrites everything after its checkpoint, so its saving is the kept prefix. S's seconds also include the branch's own readings and its AR score, which the other arms skip.

## Paired savings (generated tokens, both arms reached the target)

| comparison | pairs | median tokens | median saving |
|---|---|---|---|
| S vs R | 16 | 166 vs 374 | 46% |
| P vs R | 14 | 196 vs 284 | 33% |
| A vs R | 15 | 181 vs 324 | 47% |
| S vs A | 19 | 235 vs 226 | -3% |

## By branch position (S vs R)

| position | cases | pairs | median prefix tokens kept | median saving |
|---|---|---|---|---|
| early | 19 | 3 | 28 | -7% |
| mid | 19 | 11 | 183 | 45% |
| late | 5 | 2 | 276 | 79% |

## What the steer itself costs (S)

- Setup chat calls (target title): median 102 prompt + 7.0 completion tokens (completion counted in S's generated tokens above).
- /contrast calls: 43 over 43 cases (replays only, in prefill).
- Loop-guard retries: 0 over 43 cases (their tokens are in S's generated count).
- Anchored opening: median 8.0 tokens, inserted, not generated (same for A).
- R kept the original text before the branch point in 2/43 cases; S, A and P keep it by construction.
- Not counted for any arm: readings and alternatives for the new text, which any regenerated answer also gets.

## Cases

| prompt | position | reading → target | S | A | P | R | tokens S / A / P / R |
|---|---|---|---|---|---|---|---|
| Give me 4 numbered steps to start a vegetable ga | early (14 kept) | *choosing a planting location* → *preparing the soil* | full | full | full | full | 244 / 247 / 288 / 228 |
| Give me 4 numbered steps to start a vegetable ga | mid (137 kept) | *improving the soil* → *amending soil with organic matter* | full | full | full | full | 130 / 108 / 133 / 324 |
| What are the steps to train for a marathon? | early (19 kept) | *outlining a fitness journey* → *selecting appropriate gear* | none (cap) | none (cap) | partial (cap) | full (cap) | 410 / 400 / 400 / 419 |
| What are the steps to train for a marathon? | mid (170 kept) | *detailing endurance-building phases* → *defining key milestones* | full (cap) | full (cap) | full (cap) | full (cap) | 405 / 400 / 400 / 570 |
| List 4 tips for saving money on groceries, numbe | early (0 kept) | *advising to make a shopping list* → *choosing store brands* | full | full | none | full | 135 / 190 / 89 / 89 |
| List 4 tips for saving money on groceries, numbe | mid (83 kept) | *suggesting bulk purchases* → *storing food properly* | full | full | full | full | 124 / 72 / 98 / 78 |
| How do I set up a new laptop? Give numbered step | early (13 kept) | *listing initial inspection steps* → *connecting to Wi-Fi* | full (cap) | full (cap) | full (cap) | full (cap) | 407 / 400 / 400 / 413 |
| How do I set up a new laptop? Give numbered step | mid (180 kept) | *updating and installing software* → *connecting to internet* | full | full | full | full | 321 / 297 / 355 / 525 |
| Explain how to make a cup of pour-over coffee st | early (35 kept) | *Section* → *gathering the required materials* | full (cap) | full (cap) | full (cap) | full (cap) | 405 / 400 / 400 / 435 |
| Explain how to make a cup of pour-over coffee st | mid (348 kept) | *describing coffee pouring process* → *describing the brewing duration* | full | full | partial | full | 182 / 181 / 230 / 639 |
| What should I consider when adopting a dog? Use  | early (23 kept) | *exploring reasons for pet adoption* → *researching breeds* | full | full | full (cap) | full (cap) | 368 / 361 / 400 / 423 |
| What should I consider when adopting a dog? Use  | mid (165 kept) | *discussing home safety measures* → *evaluating breed characteristics* | full | full | partial | full | 301 / 324 / 380 / 510 |
| Give me a 5-step plan to learn to play guitar. | early (110 kept) | *tuning the guitar* → *choosing the right guitar* | full (cap) | full (cap) | partial (cap) | full (cap) | 406 / 400 / 400 / 510 |
| Give me a 5-step plan to learn to play guitar. | mid (194 kept) | *detailing finger strength exercises* → *choosing a teaching method* | partial | partial | none (cap) | full (cap) | 392 / 387 / 400 / 594 |
| How do I prepare for a job interview at a tech c | early (21 kept) | *initiating company research* → *preparing relevant projects* | full | full | none (cap) | full (cap) | 396 / 397 / 400 / 421 |
| How do I prepare for a job interview at a tech c | mid (175 kept) | *mentioning technical skills* → *practicing communication skills* | full | full | full | full | 242 / 243 / 295 / 451 |
| Describe how a bill becomes law in the United St | early (42 kept) | *defining the legislative process* → *drafting the bill* | partial (cap) | partial (cap) | full (cap) | full (cap) | 405 / 400 / 400 / 442 |
| Describe how a bill becomes law in the United St | mid (216 kept) | *defining the final passage condition* → *sending to the other chamber* | full | full | full (cap) | full (cap) | 401 / 389 / 400 / 616 |
| What are the main causes of World War I? List th | early (31 kept) | *listing the main causes* → *discussing the arms race between European powers* | partial (cap) | partial (cap) | full (cap) | full (cap) | 408 / 400 / 400 / 431 |
| What are the main causes of World War I? List th | mid (213 kept) | *defining militarism* → *explaining militarism's role* | full | full | full (cap) | full (cap) | 278 / 313 / 400 / 613 |
| What are the main causes of World War I? List th | late (354 kept) | *describing economic competition* → *describing industrial rivalry* | full | full | full | full | 149 / 133 / 184 / 703 |
| Explain how vaccines work in a short paragraph o | mid (47 kept) | *describing vaccine interaction* → *triggering antibody production* | full | full | full | full | 91 / 48 / 117 / 148 |
| Explain how vaccines work in a short paragraph o | late (95 kept) | *explaining how vaccination builds immunity* → *explaining antibody production* | partial | partial | full | full | 21 / 18 / 65 / 206 |
| How can I improve my sleep? Give numbered tips. | early (13 kept) | *defining a sleep schedule* → *avoiding caffeine and heavy meals* | full (cap) | full (cap) | full (cap) | full | 410 / 400 / 400 / 393 |
| How can I improve my sleep? Give numbered tips. | mid (201 kept) | *detailing drinking habits* → *discussing caffeine and alcohol intake* | full | full | none | full | 270 / 259 / 288 / 492 |
| I'm buying my first car. Walk me through the pro | early (29 kept) | *defining the budget determination* → *researching car types* | full (cap) | full (cap) | full (cap) | full (cap) | 404 / 400 / 400 / 429 |
| I'm buying my first car. Walk me through the pro | mid (248 kept) | *describing the test-driving process* → *evaluating vehicle models* | partial (cap) | partial (cap) | full (cap) | full (cap) | 405 / 400 / 400 / 648 |
| Plan a 3-day trip to Tokyo for a first-time visi | early (31 kept) | *describing central Tokyo exploration* → *suggesting lunch options* | full (cap) | none (cap) | full (cap) | full (cap) | 413 / 400 / 400 / 431 |
| Plan a 3-day trip to Tokyo for a first-time visi | late (378 kept) | *exploring historical and cultural sites* → *visiting the Tokyo National Museum* | full (cap) | full (cap) | full (cap) | full | 411 / 400 / 400 / 722 |
| Write a Python function that returns the n-th Fi | early (39 kept) | *explaining the iterative approach* → *highlighting time complexity* | full (cap) | full (cap) | none (cap) | full (cap) | 404 / 400 / 400 / 439 |
| Write a Python function that returns the n-th Fi | mid (210 kept) | *explaining the iterative approach* → *comparing efficiency* | full | full (cap) | full (cap) | full | 258 / 400 / 400 / 576 |
| My React app re-renders constantly. How do I deb | early (20 kept) | *identifying the problematic component* → *exploring lifecycle methods* | full (cap) | full (cap) | none (cap) | full (cap) | 408 / 400 / 400 / 420 |
| My React app re-renders constantly. How do I deb | mid (183 kept) | *reviewing props and state efficiency* → *optimizing component updates* | full | full (cap) | full | full (cap) | 388 / 400 / 398 / 583 |
| Should I rent or buy a home? Compare the options | early (28 kept) | *outlining home buying options* → *outlining advantages of owning* | full (cap) | full (cap) | full | full (cap) | 410 / 400 / 356 / 428 |
| Should I rent or buy a home? Compare the options | mid (209 kept) | *mentioning limited customization* → *outlining maintenance responsibilities* | partial (cap) | partial (cap) | none (cap) | full | 405 / 400 / 400 / 545 |
| Outline a 5-paragraph essay on the effects of so | early (37 kept) | *exploring social media's impact* → *providing statistical evidence* | partial (cap) | partial (cap) | partial (cap) | full (cap) | 409 / 400 / 400 / 437 |
| Outline a 5-paragraph essay on the effects of so | mid (241 kept) | *exploring societal impacts* → *exploring cultural impacts* | partial | full (cap) | full | full | 381 / 400 / 369 / 552 |
| Give me a simple recipe for banana bread. | early (19 kept) | *listing chocolate chip cookies ingredients* → *describing preparation steps* | partial (cap) | partial (cap) | full (cap) | full (cap) | 404 / 400 / 400 / 419 |
| Give me a simple recipe for banana bread. | mid (166 kept) | *describing wet ingredient combination* → *preparing the dry mix* | full | full | full | full | 235 / 226 / 291 / 425 |
| Give me a simple recipe for banana bread. | late (276 kept) | *describing baking instructions* → *adding optional ingredients* | partial | partial | full | full | 121 / 110 / 267 / 445 |
| Explain why the sky is blue in plain prose, no l | early (33 kept) | *describing light's color composition* → *explaining light interaction* | full | full | full | full | 109 / 60 / 207 / 243 |
| Explain why the sky is blue in plain prose, no l | mid (69 kept) | *explaining scattering intensity* → *explaining the scattering effect* | full | full | full | full | 112 / 94 / 142 / 210 |
| Explain why the sky is blue in plain prose, no l | late (111 kept) | *explaining red appearance at sunrise* → *explaining the effect of sunlight angle* | full | full | full | full | 50 / 49 / 129 / 234 |

## Example texts

### Give me 4 numbered steps to start a vegetable garden.

Branch at *Choose the Right Location* (early, 14 tokens kept), toward *preparing the soil*.

**S steered** (238 tokens, judge: full):

> 1. **Select the Ideal Soil Conditions**: Choose a location that receives at least six hours of sunlight per day. Prepare the soil by testing its pH level and enriching it with compost or well-rotted manure to ensure it is fertile and well-draining. If necessary, amend the soil to improve its quality.

**A anchor only** (247 tokens, judge: full):

> 1. **Select the Ideal Soil Conditions**: Choose a location that receives at least six hours of sunlight per day. Prepare the soil by testing its pH level and enriching it with compost or well-rotted manure. Good soil should be loose, fertile, and well-draining.

**P prefix + instruction** (288 tokens, judge: full):

> 1. **Prepare the Soil**: Begin by testing your soil to determine its pH level and nutrient content. You can purchase a soil testing kit from a garden center or online. Based on the results, amend the soil with compost, manure, or other organic matter to improve fertility and structure. Remove any weeds and debris from the area where you plan to plant. Ensure the soil is loose and well-draining before planting.

**R re-prompt** (228 tokens, judge: full):

> Sure! Here are four steps to start a vegetable garden, with an emphasis on preparing the soil:
>
> 1. **Choose Your Vegetables**: Decide which vegetables you want to grow based on your preferences, climate, and space availability. Consider factors like sunlight requirements, water needs, and growth habits when selecting your plants.
>
> 2. **Prepare the Soil**: Test your soil to determine its pH level and nutrient content. Amend the soil as needed with compost, manure, or other organic matter to improve fertility and structure. Remove any weeds and debris from the planting area to ensure a clean and

### Give me 4 numbered steps to start a vegetable garden.

Branch at *Prepare the Soil* (mid, 137 tokens kept), toward *amending soil with organic matter*.

**S steered** (122 tokens, judge: full):

> 3. **Amend the Soil with Organic Matter**: Before planting, test your soil to understand its pH level and nutrient content. Amend the soil with compost, well-rotted manure, or other organic materials to improve fertility and structure. This will provide a healthy environment for your plants to grow.

**A anchor only** (108 tokens, judge: full):

> 3. **Amend the Soil with Organic Matter**: Test your soil to understand its pH level and nutrient content. Amend it with compost, well-rotted manure, or other organic materials to improve fertility and structure. This will provide a healthy environment for your plants to grow.

**P prefix + instruction** (133 tokens, judge: full):

> 3. **Amend the Soil with Organic Matter**: Enhance the fertility and structure of your soil by adding organic matter such as compost, well-rotted manure, or leaf mold. Mix these materials into the top 6-12 inches of soil to improve its texture and nutrient content. This step is crucial for providing a healthy environment for your plants to grow.

**R re-prompt** (324 tokens, judge: full):

> Sure! Here are four steps to start a vegetable garden, with an added section on amending the soil with organic matter:
>
> 1. **Choose the Right Location**: Select a spot in your yard that receives at least six hours of sunlight per day. Ensure the area has good drainage and is not prone to standing water. Consider the proximity to a water source for easy irrigation.
>
> 2. **Plan Your Garden Layout**: Decide what vegetables you want to grow based on your preferences and the climate in your region. Sketch out a layout, considering the space requirements of each plant and how they will be rotated fro

### What are the steps to train for a marathon?

Branch at *Here’s a general guide to help you get* (early, 19 tokens kept), toward *selecting appropriate gear*.

**S steered** (400 tokens, judge: none):

> Here’s a general guide to help you select a training plan and prepare for your marathon:

**A anchor only** (400 tokens, judge: none):

> Here’s a general guide to help you select a training plan and prepare for your marathon:

**P prefix + instruction** (400 tokens, judge: partial):

> Here’s a general guide to help you get started, followed by a detailed section on selecting appropriate gear.

**R re-prompt** (419 tokens, judge: full):

> Training for a marathon is an exciting journey that requires dedication, consistency, and proper preparation. Here’s a general guide to help you get started, followed by a detailed section on selecting appropriate gear to ensure comfort and performance during your long runs.
>
> ### Selecting Appropriate Gear
>
> #### Shoes
> Choosing the right running shoes is crucial for preventing injuries and ensuring optimal performance. Here are some key factors to consider:
>
> 1. **Fit**: Ensure your shoes fit well, with enough room in the toe box and a snug heel. Your toes should not hit the front of the shoe wh
