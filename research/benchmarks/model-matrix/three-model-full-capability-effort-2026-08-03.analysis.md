<!-- markdownlint-configure-file { "MD013": false } -->

# xcsh three-model benchmark analysis

Source run: 2026-08-03T17:25:02.828Z
Analysis generated: 2026-08-03T21:45:46.270Z
Matrix: 3 models × 5 efforts × 12 scenarios × 1 measured run, after 0 warm-up run(s)
Reasoning efforts: low, medium, high, xhigh, max; order: rotating-round-robin; context: example-corp

Publication note: representative responses replace live tenant, namespace, username, and home-path identifiers with the synthetic forms `example-corp`, `demo-app`, `operator`, and `/Users/you`. Six invalid low/medium GitHub CLI observations were replaced with post-repair reruns that passed 6/6; all other outputs and measurements are unchanged.

## Results

low: balanced GPT-5.6 Sol; quality Claude Opus 5; speed GPT-5.6 Sol
medium: balanced GPT-5.6 Sol; quality GPT-5.6 Sol; speed GPT-5.6 Sol
high: balanced GPT-5.6 Sol; quality GPT-5.6 Sol; speed GPT-5.6 Sol
xhigh: balanced GPT-5.6 Sol; quality GPT-5.6 Sol; speed GPT-5.6 Sol
max: balanced GPT-5.6 Sol; quality Gemini 3.6 Flash; speed GPT-5.6 Sol

| Effort requested→effective | Rank | Model | Balanced | Quality rank/score | Speed rank/score | Reliability | TTFT p50 | End-to-end p50 | TTFT wins |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low→low | 1 | GPT-5.6 Sol | 98.5 | 3 / 98.8 | 1 / 96.2 | 100.0 | 4659.4 ms | 5488.6 ms | 10/12 |
| low→low | 2 | Claude Opus 5 | 93.5 | 1 / 99.2 | 2 / 70.1 | 100.0 | 7107.7 ms | 8677.5 ms | 2/12 |
| low→low | 3 | Gemini 3.6 Flash | 88.8 | 2 / 98.8 | 3 / 47.6 | 100.0 | 11734.3 ms | 11734.5 ms | 0/12 |
| medium→medium | 1 | GPT-5.6 Sol | 98.6 | 1 / 98.8 | 1 / 96.8 | 100.0 | 4426.2 ms | 6094.9 ms | 11/12 |
| medium→medium | 2 | Claude Opus 5 | 92.4 | 2 / 98.3 | 2 / 67.0 | 100.0 | 6872.3 ms | 7893.9 ms | 1/12 |
| medium→medium | 3 | Gemini 3.6 Flash | 87.5 | 3 / 98.3 | 3 / 42.7 | 100.0 | 12165.7 ms | 12166.7 ms | 0/12 |
| high→high | 1 | GPT-5.6 Sol | 98.6 | 1 / 98.8 | 1 / 96.7 | 100.0 | 5057.2 ms | 5641.0 ms | 10/12 |
| high→high | 2 | Claude Opus 5 | 91.1 | 2 / 98.3 | 2 / 60.5 | 100.0 | 7754.0 ms | 8346.4 ms | 2/12 |
| high→high | 3 | Gemini 3.6 Flash | 87.1 | 3 / 98.3 | 3 / 40.6 | 100.0 | 12579.4 ms | 12579.4 ms | 0/12 |
| xhigh→xhigh | 1 | GPT-5.6 Sol | 99.7 | 1 / 100.0 | 1 / 98.3 | 100.0 | 5437.5 ms | 5844.2 ms | 11/12 |
| xhigh→xhigh | 2 | Claude Opus 5 | 91.4 | 3 / 97.1 | 2 / 66.0 | 100.0 | 7470.0 ms | 8055.5 ms | 1/12 |
| xhigh→high | 3 | Gemini 3.6 Flash | 89.3 | 2 / 98.3 | 3 / 51.4 | 100.0 | 11771.9 ms | 11771.9 ms | 0/12 |
| max→xhigh | 1 | GPT-5.6 Sol | 99.1 | 2 / 98.8 | 1 / 99.4 | 100.0 | 5495.3 ms | 6893.8 ms | 11/12 |
| max→high | 2 | Gemini 3.6 Flash | 89.4 | 1 / 99.2 | 3 / 49.6 | 100.0 | 12515.1 ms | 12515.2 ms | 0/12 |
| max→max | 3 | Claude Opus 5 | 86.0 | 3 / 89.6 | 2 / 65.3 | 95.8 | 7259.0 ms | 7450.4 ms | 1/12 |

The balanced score is a decision aid, not a universal model ranking: 60% rubric-scored output quality, 20% reliability, and 20% relative speed. Quality and speed ranks remain separate so the weighting cannot hide their trade-off.

## Per-scenario performance and quality matrix

| Scenario | Effort requested→effective | Model | Contract | Quality | TTFT p50/p95 | TTFT CV | First tool p50 | End-to-end p50/p95 | Output tokens/s | Words p50 | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ping | low→low | Gemini 3.6 Flash | 100.0% | 100.0 | 6073.7/6073.7 ms | 0.000 | — ms | 6074.1/6074.1 ms | 0.3 | 1.0 | 0/unreported |
| ping | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 2492.3/2492.3 ms | 0.000 | — ms | 2629.3/2629.3 ms | 2.3 | 1.0 | 0/unreported |
| ping | low→low | Claude Opus 5 | 100.0% | 100.0 | 2698.3/2698.3 ms | 0.000 | — ms | 3783.2/3783.2 ms | 1.3 | 1.0 | $0.107000 |
| ping | medium→medium | Gemini 3.6 Flash | 100.0% | 100.0 | 6019.1/6019.1 ms | 0.000 | — ms | 6019.1/6019.1 ms | 13.8 | 1.0 | 0/unreported |
| ping | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 1381.1/1381.1 ms | 0.000 | — ms | 1439.0/1439.0 ms | 4.2 | 1.0 | 0/unreported |
| ping | medium→medium | Claude Opus 5 | 100.0% | 100.0 | 2308.4/2308.4 ms | 0.000 | — ms | 3307.1/3307.1 ms | 1.5 | 1.0 | $0.107000 |
| ping | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 5933.8/5933.8 ms | 0.000 | — ms | 5934.1/5934.1 ms | 17.7 | 1.0 | 0/unreported |
| ping | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 1322.8/1322.8 ms | 0.000 | — ms | 1418.6/1418.6 ms | 4.3 | 1.0 | 0/unreported |
| ping | high→high | Claude Opus 5 | 100.0% | 100.0 | 2586.3/2586.3 ms | 0.000 | — ms | 3378.2/3378.2 ms | 1.5 | 1.0 | $0.107000 |
| ping | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 5812.2/5812.2 ms | 0.000 | — ms | 5812.3/5812.3 ms | 20.7 | 1.0 | 0/unreported |
| ping | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 1591.2/1591.2 ms | 0.000 | — ms | 1649.4/1649.4 ms | 3.6 | 1.0 | 0/unreported |
| ping | xhigh→xhigh | Claude Opus 5 | 100.0% | 100.0 | 2896.9/2896.9 ms | 0.000 | — ms | 3751.0/3751.0 ms | 1.3 | 1.0 | $0.107000 |
| ping | max→high | Gemini 3.6 Flash | 100.0% | 100.0 | 4959.5/4959.5 ms | 0.000 | — ms | 4959.8/4959.8 ms | 23.4 | 1.0 | 0/unreported |
| ping | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 2307.6/2307.6 ms | 0.000 | — ms | 2357.1/2357.1 ms | 2.6 | 1.0 | 0/unreported |
| ping | max→max | Claude Opus 5 | 100.0% | 100.0 | 2036.7/2036.7 ms | 0.000 | — ms | 2925.1/2925.1 ms | 1.7 | 1.0 | $0.107000 |
| assistant-identity | low→low | Gemini 3.6 Flash | 100.0% | 95.0 | 6986.1/6986.1 ms | 0.000 | — ms | 6987.2/6987.2 ms | 33.9 | 147.0 | 0/unreported |
| assistant-identity | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 4337.9/4337.9 ms | 0.000 | 2374.0 ms | 8739.9/8739.9 ms | 47.8 | 196.0 | 0/unreported |
| assistant-identity | low→low | Claude Opus 5 | 100.0% | 90.0 | 2356.2/2356.2 ms | 0.000 | — ms | 13177.6/13177.6 ms | 57.5 | 309.0 | $0.135000 |
| assistant-identity | medium→medium | Gemini 3.6 Flash | 100.0% | 95.0 | 10045.3/10045.3 ms | 0.000 | — ms | 10045.5/10045.5 ms | 111.2 | 87.0 | 0/unreported |
| assistant-identity | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 3908.1/3908.1 ms | 0.000 | 2139.1 ms | 7912.0/7912.0 ms | 49.9 | 190.0 | 0/unreported |
| assistant-identity | medium→medium | Claude Opus 5 | 100.0% | 90.0 | 8252.0/8252.0 ms | 0.000 | 5134.6 ms | 23117.1/23117.1 ms | 56.3 | 392.0 | $0.182000 |
| assistant-identity | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 19758.1/19758.1 ms | 0.000 | 10482.2 ms | 19758.8/19758.8 ms | 108.5 | 199.0 | 0/unreported |
| assistant-identity | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 6064.8/6064.8 ms | 0.000 | 3108.9 ms | 10222.1/10222.1 ms | 57.1 | 196.0 | 0/unreported |
| assistant-identity | high→high | Claude Opus 5 | 100.0% | 90.0 | 12759.7/12759.7 ms | 0.000 | 7924.2 ms | 25063.6/25063.6 ms | 55.7 | 316.0 | $0.186000 |
| assistant-identity | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 10361.6/10361.6 ms | 0.000 | — ms | 10361.7/10361.7 ms | 102.0 | 132.0 | 0/unreported |
| assistant-identity | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 9944.8/9944.8 ms | 0.000 | 4064.2 ms | 13140.7/13140.7 ms | 92.6 | 173.0 | 0/unreported |
| assistant-identity | xhigh→xhigh | Claude Opus 5 | 100.0% | 75.0 | 15489.2/15489.2 ms | 0.000 | 7066.7 ms | 32772.4/32772.4 ms | 61.5 | 441.0 | $0.254000 |
| assistant-identity | max→high | Gemini 3.6 Flash | 100.0% | 95.0 | 10981.1/10981.1 ms | 0.000 | — ms | 10981.1/10981.1 ms | 109.9 | 121.0 | 0/unreported |
| assistant-identity | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 6590.9/6590.9 ms | 0.000 | 3358.3 ms | 10180.9/10180.9 ms | 83.2 | 211.0 | 0/unreported |
| assistant-identity | max→max | Claude Opus 5 | 100.0% | 0.0 | —/— ms | — | — ms | —/— ms | — | 255.0 | 0/unreported |
| user-assistance | low→low | Gemini 3.6 Flash | 100.0% | 90.0 | 7778.2/7778.2 ms | 0.000 | — ms | 7779.7/7779.7 ms | 65.8 | 303.0 | 0/unreported |
| user-assistance | low→low | GPT-5.6 Sol | 100.0% | 85.0 | 2645.1/2645.1 ms | 0.000 | — ms | 5382.6/5382.6 ms | 65.3 | 197.0 | 0/unreported |
| user-assistance | low→low | Claude Opus 5 | 100.0% | 100.0 | 4335.3/4335.3 ms | 0.000 | — ms | 13331.3/13331.3 ms | 58.2 | 261.0 | $0.126000 |
| user-assistance | medium→medium | Gemini 3.6 Flash | 100.0% | 85.0 | 9452.8/9452.8 ms | 0.000 | — ms | 9452.9/9452.9 ms | 102.9 | 240.0 | 0/unreported |
| user-assistance | medium→medium | GPT-5.6 Sol | 100.0% | 85.0 | 4033.8/4033.8 ms | 0.000 | — ms | 7805.8/7805.8 ms | 73.2 | 186.0 | 0/unreported |
| user-assistance | medium→medium | Claude Opus 5 | 100.0% | 90.0 | 4047.4/4047.4 ms | 0.000 | — ms | 16921.8/16921.8 ms | 61.5 | 354.0 | $0.133000 |
| user-assistance | high→high | Gemini 3.6 Flash | 100.0% | 80.0 | 8982.1/8982.1 ms | 0.000 | — ms | 8982.2/8982.2 ms | 107.6 | 216.0 | 0/unreported |
| user-assistance | high→high | GPT-5.6 Sol | 100.0% | 85.0 | 3765.4/3765.4 ms | 0.000 | — ms | 7030.4/7030.4 ms | 75.6 | 176.0 | 0/unreported |
| user-assistance | high→high | Claude Opus 5 | 100.0% | 90.0 | 23083.0/23083.0 ms | 0.000 | — ms | 40316.3/40316.3 ms | 68.2 | 527.0 | $0.175000 |
| user-assistance | xhigh→high | Gemini 3.6 Flash | 100.0% | 80.0 | 12935.7/12935.7 ms | 0.000 | — ms | 12936.0/12936.0 ms | 112.3 | 225.0 | 0/unreported |
| user-assistance | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 7932.3/7932.3 ms | 0.000 | — ms | 11247.5/11247.5 ms | 111.0 | 198.0 | 0/unreported |
| user-assistance | xhigh→xhigh | Claude Opus 5 | 100.0% | 90.0 | 22933.4/22933.4 ms | 0.000 | — ms | 44726.2/44726.2 ms | 59.0 | 517.0 | $0.173000 |
| user-assistance | max→high | Gemini 3.6 Flash | 100.0% | 95.0 | 10716.7/10716.7 ms | 0.000 | — ms | 10716.8/10716.8 ms | 118.7 | 248.0 | 0/unreported |
| user-assistance | max→xhigh | GPT-5.6 Sol | 100.0% | 85.0 | 4711.9/4711.9 ms | 0.000 | — ms | 8908.4/8908.4 ms | 86.0 | 244.0 | 0/unreported |
| user-assistance | max→max | Claude Opus 5 | 100.0% | 75.0 | 30526.8/30526.8 ms | 0.000 | — ms | 44934.7/44934.7 ms | 68.0 | 432.0 | $0.183000 |
| read-tool | low→low | Gemini 3.6 Flash | 100.0% | 100.0 | 10193.9/10193.9 ms | 0.000 | 5083.9 ms | 10194.1/10194.1 ms | 18.9 | 1.0 | 0/unreported |
| read-tool | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 2973.0/2973.0 ms | 0.000 | 1847.1 ms | 3278.6/3278.6 ms | 15.2 | 1.0 | 0/unreported |
| read-tool | low→low | Claude Opus 5 | 100.0% | 100.0 | 6525.7/6525.7 ms | 0.000 | 4501.3 ms | 6731.8/6731.8 ms | 22.2 | 1.0 | $0.131000 |
| read-tool | medium→medium | Gemini 3.6 Flash | 100.0% | 100.0 | 12187.9/12187.9 ms | 0.000 | 7168.2 ms | 12188.4/12188.4 ms | 20.5 | 1.0 | 0/unreported |
| read-tool | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 4273.2/4273.2 ms | 0.000 | 1624.7 ms | 5525.3/5525.3 ms | 9.0 | 1.0 | 0/unreported |
| read-tool | medium→medium | Claude Opus 5 | 100.0% | 100.0 | 5939.8/5939.8 ms | 0.000 | 3940.2 ms | 6136.3/6136.3 ms | 24.8 | 1.0 | $0.131000 |
| read-tool | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 10441.4/10441.4 ms | 0.000 | 5160.1 ms | 10441.4/10441.4 ms | 28.9 | 1.0 | 0/unreported |
| read-tool | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 3750.8/3750.8 ms | 0.000 | 2399.4 ms | 4088.1/4088.1 ms | 12.1 | 1.0 | 0/unreported |
| read-tool | high→high | Claude Opus 5 | 100.0% | 100.0 | 8374.2/8374.2 ms | 0.000 | 6720.1 ms | 8614.4/8614.4 ms | 17.6 | 1.0 | $0.131000 |
| read-tool | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 11567.1/11567.1 ms | 0.000 | 6082.6 ms | 11567.1/11567.1 ms | 21.7 | 1.0 | 0/unreported |
| read-tool | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 5967.5/5967.5 ms | 0.000 | 4366.7 ms | 6143.4/6143.4 ms | 8.0 | 1.0 | 0/unreported |
| read-tool | xhigh→xhigh | Claude Opus 5 | 100.0% | 100.0 | 7007.4/7007.4 ms | 0.000 | 3804.5 ms | 7596.2/7596.2 ms | 20.0 | 1.0 | $0.131000 |
| read-tool | max→high | Gemini 3.6 Flash | 100.0% | 100.0 | 12409.3/12409.3 ms | 0.000 | 6636.3 ms | 12409.4/12409.4 ms | 23.1 | 1.0 | 0/unreported |
| read-tool | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 4172.3/4172.3 ms | 0.000 | 2349.8 ms | 4222.1/4222.1 ms | 11.7 | 1.0 | 0/unreported |
| read-tool | max→max | Claude Opus 5 | 100.0% | 100.0 | 6033.5/6033.5 ms | 0.000 | 3986.8 ms | 6174.8/6174.8 ms | 24.6 | 1.0 | $0.131000 |
| plugin-skill | low→low | Gemini 3.6 Flash | 100.0% | 100.0 | 14311.9/14311.9 ms | 0.000 | 5103.4 ms | 14312.2/14312.2 ms | 15.5 | 1.0 | 0/unreported |
| plugin-skill | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 7292.6/7292.6 ms | 0.000 | 1909.9 ms | 7855.5/7855.5 ms | 12.7 | 1.0 | 0/unreported |
| plugin-skill | low→low | Claude Opus 5 | 100.0% | 100.0 | 9175.5/9175.5 ms | 0.000 | 4594.3 ms | 9401.3/9401.3 ms | 20.9 | 1.0 | $0.136000 |
| plugin-skill | medium→medium | Gemini 3.6 Flash | 100.0% | 100.0 | 15125.4/15125.4 ms | 0.000 | 5289.6 ms | 15125.7/15125.7 ms | 21.2 | 1.0 | 0/unreported |
| plugin-skill | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 6439.1/6439.1 ms | 0.000 | 2153.1 ms | 7253.2/7253.2 ms | 14.9 | 1.0 | 0/unreported |
| plugin-skill | medium→medium | Claude Opus 5 | 100.0% | 100.0 | 9531.8/9531.8 ms | 0.000 | 4899.9 ms | 9754.3/9754.3 ms | 20.2 | 1.0 | $0.136000 |
| plugin-skill | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 15359.1/15359.1 ms | 0.000 | 6159.9 ms | 15359.7/15359.7 ms | 39.2 | 1.0 | 0/unreported |
| plugin-skill | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 4909.0/4909.0 ms | 0.000 | 1883.9 ms | 5239.6/5239.6 ms | 20.6 | 1.0 | 0/unreported |
| plugin-skill | high→high | Claude Opus 5 | 100.0% | 100.0 | 11221.9/11221.9 ms | 0.000 | 3891.7 ms | 11364.5/11364.5 ms | 17.2 | 1.0 | $0.136000 |
| plugin-skill | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 15626.7/15626.7 ms | 0.000 | 5934.6 ms | 15626.7/15626.7 ms | 26.7 | 1.0 | 0/unreported |
| plugin-skill | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 9068.9/9068.9 ms | 0.000 | 3049.9 ms | 9353.4/9353.4 ms | 13.3 | 1.0 | 0/unreported |
| plugin-skill | xhigh→xhigh | Claude Opus 5 | 100.0% | 100.0 | 8096.2/8096.2 ms | 0.000 | 3842.1 ms | 8514.9/8514.9 ms | 23.3 | 1.0 | $0.136000 |
| plugin-skill | max→high | Gemini 3.6 Flash | 100.0% | 100.0 | 14945.9/14945.9 ms | 0.000 | 4734.2 ms | 14945.9/14945.9 ms | 27.4 | 1.0 | 0/unreported |
| plugin-skill | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 6278.8/6278.8 ms | 0.000 | 2531.0 ms | 6557.6/6557.6 ms | 19.6 | 1.0 | 0/unreported |
| plugin-skill | max→max | Claude Opus 5 | 100.0% | 100.0 | 9167.9/9167.9 ms | 0.000 | 3695.3 ms | 9461.0/9461.0 ms | 21.2 | 1.0 | $0.136000 |
| plugin-tool | low→low | Gemini 3.6 Flash | 100.0% | 100.0 | 11522.4/11522.4 ms | 0.000 | 6060.2 ms | 11522.8/11522.8 ms | 4.4 | 1.0 | 0/unreported |
| plugin-tool | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 3657.7/3657.7 ms | 0.000 | 2008.4 ms | 4201.7/4201.7 ms | 11.3 | 1.0 | 0/unreported |
| plugin-tool | low→low | Claude Opus 5 | 100.0% | 100.0 | 4781.9/4781.9 ms | 0.000 | 3058.5 ms | 5063.0/5063.0 ms | 23.4 | 1.0 | $0.124000 |
| plugin-tool | medium→medium | Gemini 3.6 Flash | 100.0% | 100.0 | 10008.3/10008.3 ms | 0.000 | 5371.4 ms | 10008.4/10008.4 ms | 29.6 | 1.0 | 0/unreported |
| plugin-tool | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 9050.1/9050.1 ms | 0.000 | 5245.7 ms | 9434.3/9434.3 ms | 5.0 | 1.0 | 0/unreported |
| plugin-tool | medium→medium | Claude Opus 5 | 100.0% | 100.0 | 5509.3/5509.3 ms | 0.000 | 3910.6 ms | 5779.8/5779.8 ms | 20.6 | 1.0 | $0.124000 |
| plugin-tool | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 10699.7/10699.7 ms | 0.000 | 5445.3 ms | 10700.6/10700.6 ms | 23.6 | 1.0 | 0/unreported |
| plugin-tool | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 3392.6/3392.6 ms | 0.000 | 1968.5 ms | 3830.9/3830.9 ms | 12.4 | 1.0 | 0/unreported |
| plugin-tool | high→high | Claude Opus 5 | 100.0% | 100.0 | 5488.4/5488.4 ms | 0.000 | 3576.7 ms | 5784.1/5784.1 ms | 21.0 | 1.0 | $0.124000 |
| plugin-tool | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 10607.7/10607.7 ms | 0.000 | 5766.8 ms | 10623.0/10623.0 ms | 26.7 | 1.0 | 0/unreported |
| plugin-tool | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 3228.9/3228.9 ms | 0.000 | 1942.0 ms | 3572.6/3572.6 ms | 13.3 | 1.0 | 0/unreported |
| plugin-tool | xhigh→xhigh | Claude Opus 5 | 100.0% | 100.0 | 5780.0/5780.0 ms | 0.000 | 3973.1 ms | 6082.1/6082.1 ms | 20.0 | 1.0 | $0.124000 |
| plugin-tool | max→high | Gemini 3.6 Flash | 100.0% | 100.0 | 11193.1/11193.1 ms | 0.000 | 5813.0 ms | 11193.2/11193.2 ms | 23.3 | 1.0 | 0/unreported |
| plugin-tool | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 3723.7/3723.7 ms | 0.000 | 2277.6 ms | 4172.8/4172.8 ms | 21.5 | 1.0 | 0/unreported |
| plugin-tool | max→max | Claude Opus 5 | 100.0% | 100.0 | 6701.7/6701.7 ms | 0.000 | 4954.0 ms | 6965.6/6965.6 ms | 17.4 | 1.0 | $0.124000 |
| authenticated-context | low→low | Gemini 3.6 Flash | 100.0% | 100.0 | 13271.9/13271.9 ms | 0.000 | 7210.9 ms | 13272.5/13272.5 ms | 21.8 | 10.0 | 0/unreported |
| authenticated-context | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 5262.6/5262.6 ms | 0.000 | 2903.7 ms | 5708.2/5708.2 ms | 12.3 | 10.0 | 0/unreported |
| authenticated-context | low→low | Claude Opus 5 | 100.0% | 100.0 | 8065.4/8065.4 ms | 0.000 | 5816.3 ms | 8632.3/8632.3 ms | 19.1 | 10.0 | $0.196000 |
| authenticated-context | medium→medium | Gemini 3.6 Flash | 100.0% | 100.0 | 14525.9/14525.9 ms | 0.000 | 7684.1 ms | 14525.9/14525.9 ms | 33.7 | 10.0 | 0/unreported |
| authenticated-context | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 3704.2/3704.2 ms | 0.000 | 1977.5 ms | 4170.4/4170.4 ms | 17.8 | 10.0 | 0/unreported |
| authenticated-context | medium→medium | Claude Opus 5 | 100.0% | 100.0 | 7137.6/7137.6 ms | 0.000 | 4402.1 ms | 7958.9/7958.9 ms | 26.4 | 25.0 | $0.197000 |
| authenticated-context | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 12687.0/12687.0 ms | 0.000 | 6502.3 ms | 12687.1/12687.1 ms | 37.5 | 10.0 | 0/unreported |
| authenticated-context | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 5205.5/5205.5 ms | 0.000 | 3031.3 ms | 5605.3/5605.3 ms | 32.5 | 10.0 | 0/unreported |
| authenticated-context | high→high | Claude Opus 5 | 100.0% | 100.0 | 7133.7/7133.7 ms | 0.000 | 4502.7 ms | 8078.4/8078.4 ms | 26.0 | 27.0 | $0.197000 |
| authenticated-context | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 12613.8/12613.8 ms | 0.000 | 6349.1 ms | 12613.8/12613.8 ms | 38.9 | 10.0 | 0/unreported |
| authenticated-context | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 4421.4/4421.4 ms | 0.000 | 2654.1 ms | 4832.3/4832.3 ms | 55.3 | 10.0 | 0/unreported |
| authenticated-context | xhigh→xhigh | Claude Opus 5 | 100.0% | 100.0 | 7679.6/7679.6 ms | 0.000 | 4032.6 ms | 8956.8/8956.8 ms | 29.6 | 50.0 | $0.198000 |
| authenticated-context | max→high | Gemini 3.6 Flash | 100.0% | 100.0 | 13935.3/13935.3 ms | 0.000 | 6414.0 ms | 13935.5/13935.5 ms | 36.1 | 10.0 | 0/unreported |
| authenticated-context | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 8458.7/8458.7 ms | 0.000 | 6068.4 ms | 9005.0/9005.0 ms | 23.8 | 10.0 | 0/unreported |
| authenticated-context | max→max | Claude Opus 5 | 100.0% | 100.0 | 9273.9/9273.9 ms | 0.000 | 6700.2 ms | 10473.7/10473.7 ms | 22.4 | 43.0 | $0.197000 |
| github-cli-auth | low→low | Gemini 3.6 Flash | 100.0% | 100.0 | 12519.5/12519.5 ms | 0.000 | 6198.3 ms | 12519.5/12519.5 ms | 17.9 | 4.0 | 0/unreported |
| github-cli-auth | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 5190.0/5190.0 ms | 0.000 | 2481.3 ms | 5507.7/5507.7 ms | 9.3 | 4.0 | 0/unreported |
| github-cli-auth | low→low | Claude Opus 5 | 100.0% | 100.0 | 7109.8/7109.8 ms | 0.000 | 4341.4 ms | 7285.7/7285.7 ms | 15.9 | 4.0 | $0.129000 |
| github-cli-auth | medium→medium | Gemini 3.6 Flash | 100.0% | 100.0 | 12143.5/12143.5 ms | 0.000 | 6347.5 ms | 12145.1/12145.1 ms | 16.2 | 4.0 | 0/unreported |
| github-cli-auth | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 6436.2/6436.2 ms | 0.000 | 4511.3 ms | 6664.5/6664.5 ms | 6.9 | 4.0 | 0/unreported |
| github-cli-auth | medium→medium | Claude Opus 5 | 100.0% | 100.0 | 7672.5/7672.5 ms | 0.000 | 4917.2 ms | 7828.8/7828.8 ms | 15.1 | 4.0 | $0.129000 |
| github-cli-auth | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 12471.8/12471.8 ms | 0.000 | 6609.2 ms | 12471.8/12471.8 ms | 27.4 | 4.0 | 0/unreported |
| github-cli-auth | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 5345.0/5345.0 ms | 0.000 | 1970.2 ms | 5676.7/5676.7 ms | 8.6 | 4.0 | 0/unreported |
| github-cli-auth | high→high | Claude Opus 5 | 100.0% | 100.0 | 10575.6/10575.6 ms | 0.000 | 7900.8 ms | 10738.5/10738.5 ms | 10.6 | 4.0 | $0.130000 |
| github-cli-auth | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 11976.8/11976.8 ms | 0.000 | 6064.9 ms | 11976.8/11976.8 ms | 29.5 | 4.0 | 0/unreported |
| github-cli-auth | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 4053.2/4053.2 ms | 0.000 | 1989.3 ms | 4355.4/4355.4 ms | 11.3 | 4.0 | 0/unreported |
| github-cli-auth | xhigh→xhigh | Claude Opus 5 | 100.0% | 100.0 | 5505.6/5505.6 ms | 0.000 | 3154.6 ms | 5662.5/5662.5 ms | 22.5 | 4.0 | $0.130000 |
| github-cli-auth | max→high | Gemini 3.6 Flash | 100.0% | 100.0 | 12906.3/12906.3 ms | 0.000 | 6803.9 ms | 12906.3/12906.3 ms | 33.1 | 4.0 | 0/unreported |
| github-cli-auth | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 4051.4/4051.4 ms | 0.000 | 2006.8 ms | 4350.1/4350.1 ms | 11.4 | 4.0 | 0/unreported |
| github-cli-auth | max→max | Claude Opus 5 | 100.0% | 100.0 | 7259.0/7259.0 ms | 0.000 | 4056.6 ms | 7450.4/7450.4 ms | 15.7 | 4.0 | $0.130000 |
| azure-cli-auth | low→low | Gemini 3.6 Flash | 100.0% | 100.0 | 11946.2/11946.2 ms | 0.000 | 5472.8 ms | 11946.2/11946.2 ms | 3.1 | 4.0 | 0/unreported |
| azure-cli-auth | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 4980.8/4980.8 ms | 0.000 | 2221.6 ms | 5469.5/5469.5 ms | 7.9 | 4.0 | 0/unreported |
| azure-cli-auth | low→low | Claude Opus 5 | 100.0% | 100.0 | 7105.7/7105.7 ms | 0.000 | 4293.0 ms | 7164.0/7164.0 ms | 15.7 | 4.0 | $0.128000 |
| azure-cli-auth | medium→medium | Gemini 3.6 Flash | 100.0% | 100.0 | 13334.2/13334.2 ms | 0.000 | 6986.2 ms | 13334.2/13334.2 ms | 34.0 | 4.0 | 0/unreported |
| azure-cli-auth | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 3745.1/3745.1 ms | 0.000 | 1639.6 ms | 4072.0/4072.0 ms | 10.6 | 4.0 | 0/unreported |
| azure-cli-auth | medium→medium | Claude Opus 5 | 100.0% | 100.0 | 6607.0/6607.0 ms | 0.000 | 3617.7 ms | 6691.7/6691.7 ms | 16.9 | 4.0 | $0.128000 |
| azure-cli-auth | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 13589.9/13589.9 ms | 0.000 | 7227.1 ms | 13589.9/13589.9 ms | 30.5 | 4.0 | 0/unreported |
| azure-cli-auth | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 7106.4/7106.4 ms | 0.000 | 4374.0 ms | 7409.8/7409.8 ms | 5.3 | 4.0 | 0/unreported |
| azure-cli-auth | high→high | Claude Opus 5 | 100.0% | 100.0 | 6548.5/6548.5 ms | 0.000 | 3605.0 ms | 6670.3/6670.3 ms | 17.2 | 4.0 | $0.128000 |
| azure-cli-auth | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 12546.0/12546.0 ms | 0.000 | 6186.0 ms | 12546.0/12546.0 ms | 34.4 | 4.0 | 0/unreported |
| azure-cli-auth | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 4907.5/4907.5 ms | 0.000 | 2017.9 ms | 5545.0/5545.0 ms | 17.1 | 4.0 | 0/unreported |
| azure-cli-auth | xhigh→xhigh | Claude Opus 5 | 100.0% | 100.0 | 6885.9/6885.9 ms | 0.000 | 4255.1 ms | 6972.6/6972.6 ms | 16.0 | 4.0 | $0.128000 |
| azure-cli-auth | max→high | Gemini 3.6 Flash | 100.0% | 100.0 | 13185.7/13185.7 ms | 0.000 | 6881.2 ms | 13185.9/13185.9 ms | 35.1 | 4.0 | 0/unreported |
| azure-cli-auth | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 6857.6/6857.6 ms | 0.000 | 2320.0 ms | 7230.1/7230.1 ms | 5.5 | 4.0 | 0/unreported |
| azure-cli-auth | max→max | Claude Opus 5 | 100.0% | 100.0 | 6958.0/6958.0 ms | 0.000 | 3854.7 ms | 7055.4/7055.4 ms | 16.3 | 4.0 | $0.128000 |
| gitlab-cli-auth | low→low | Gemini 3.6 Flash | 100.0% | 100.0 | 14590.7/14590.7 ms | 0.000 | 5577.6 ms | 14590.7/14590.7 ms | 22.5 | 4.0 | 0/unreported |
| gitlab-cli-auth | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 9315.2/9315.2 ms | 0.000 | 1844.4 ms | 9632.8/9632.8 ms | 14.1 | 4.0 | 0/unreported |
| gitlab-cli-auth | low→low | Claude Opus 5 | 100.0% | 100.0 | 13511.1/13511.1 ms | 0.000 | 3798.3 ms | 13702.3/13702.3 ms | 18.9 | 4.0 | $0.147000 |
| gitlab-cli-auth | medium→medium | Gemini 3.6 Flash | 100.0% | 100.0 | 16222.7/16222.7 ms | 0.000 | 6055.1 ms | 16223.2/16223.2 ms | 37.7 | 4.0 | 0/unreported |
| gitlab-cli-auth | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 4641.4/4641.4 ms | 0.000 | 2358.8 ms | 5142.3/5142.3 ms | 12.4 | 4.0 | 0/unreported |
| gitlab-cli-auth | medium→medium | Claude Opus 5 | 100.0% | 100.0 | 10548.0/10548.0 ms | 0.000 | 3218.7 ms | 10759.8/10759.8 ms | 20.9 | 4.0 | $0.147000 |
| gitlab-cli-auth | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 16405.7/16405.7 ms | 0.000 | 5476.9 ms | 16406.7/16406.7 ms | 39.7 | 4.0 | 0/unreported |
| gitlab-cli-auth | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 9820.5/9820.5 ms | 0.000 | 1940.8 ms | 10167.7/10167.7 ms | 14.5 | 4.0 | 0/unreported |
| gitlab-cli-auth | high→high | Claude Opus 5 | 100.0% | 100.0 | 6817.2/6817.2 ms | 0.000 | 3758.7 ms | 7020.1/7020.1 ms | 20.9 | 4.0 | $0.148000 |
| gitlab-cli-auth | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 10894.7/10894.7 ms | 0.000 | 5429.1 ms | 10895.2/10895.2 ms | 33.3 | 4.0 | 0/unreported |
| gitlab-cli-auth | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 7324.0/7324.0 ms | 0.000 | 3164.8 ms | 7942.2/7942.2 ms | 23.1 | 4.0 | 0/unreported |
| gitlab-cli-auth | xhigh→xhigh | Claude Opus 5 | 100.0% | 100.0 | 8544.3/8544.3 ms | 0.000 | 4358.5 ms | 8875.7/8875.7 ms | 18.0 | 4.0 | $0.151000 |
| gitlab-cli-auth | max→high | Gemini 3.6 Flash | 100.0% | 100.0 | 12621.0/12621.0 ms | 0.000 | 6020.8 ms | 12621.0/12621.0 ms | 30.9 | 4.0 | 0/unreported |
| gitlab-cli-auth | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 7355.0/7355.0 ms | 0.000 | 3555.1 ms | 8136.7/8136.7 ms | 29.2 | 4.0 | 0/unreported |
| gitlab-cli-auth | max→max | Claude Opus 5 | 100.0% | 100.0 | 8814.1/8814.1 ms | 0.000 | 3711.0 ms | 9830.8/9830.8 ms | 17.5 | 4.0 | $0.151000 |
| meddpicc-skill | low→low | Gemini 3.6 Flash | 100.0% | 100.0 | 10154.3/10154.3 ms | 0.000 | 5400.6 ms | 10154.4/10154.4 ms | 17.4 | 6.0 | 0/unreported |
| meddpicc-skill | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 3600.8/3600.8 ms | 0.000 | 2301.2 ms | 3859.2/3859.2 ms | 11.8 | 6.0 | 0/unreported |
| meddpicc-skill | low→low | Claude Opus 5 | 100.0% | 100.0 | 8744.9/8744.9 ms | 0.000 | 4439.7 ms | 9254.8/9254.8 ms | 11.8 | 6.0 | $0.143000 |
| meddpicc-skill | medium→medium | Gemini 3.6 Flash | 100.0% | 100.0 | 10368.1/10368.1 ms | 0.000 | 5303.9 ms | 10368.3/10368.3 ms | 25.7 | 6.0 | 0/unreported |
| meddpicc-skill | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 4579.2/4579.2 ms | 0.000 | 1760.3 ms | 4933.3/4933.3 ms | 9.2 | 6.0 | 0/unreported |
| meddpicc-skill | medium→medium | Claude Opus 5 | 100.0% | 100.0 | 5860.6/5860.6 ms | 0.000 | 3798.0 ms | 6083.3/6083.3 ms | 18.4 | 6.0 | $0.143000 |
| meddpicc-skill | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 11486.7/11486.7 ms | 0.000 | 6265.0 ms | 11486.7/11486.7 ms | 30.8 | 6.0 | 0/unreported |
| meddpicc-skill | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 3571.5/3571.5 ms | 0.000 | 2133.0 ms | 3978.8/3978.8 ms | 21.3 | 6.0 | 0/unreported |
| meddpicc-skill | high→high | Claude Opus 5 | 100.0% | 100.0 | 5669.3/5669.3 ms | 0.000 | 3902.4 ms | 6163.7/6163.7 ms | 18.3 | 6.0 | $0.143000 |
| meddpicc-skill | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 10086.5/10086.5 ms | 0.000 | 5287.1 ms | 10086.5/10086.5 ms | 37.9 | 6.0 | 0/unreported |
| meddpicc-skill | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 4201.0/4201.0 ms | 0.000 | 2355.2 ms | 4567.6/4567.6 ms | 20.2 | 6.0 | 0/unreported |
| meddpicc-skill | xhigh→xhigh | Claude Opus 5 | 100.0% | 100.0 | 7260.4/7260.4 ms | 0.000 | 4077.7 ms | 7491.4/7491.4 ms | 15.0 | 6.0 | $0.143000 |
| meddpicc-skill | max→high | Gemini 3.6 Flash | 100.0% | 100.0 | 10721.0/10721.0 ms | 0.000 | 5529.0 ms | 10721.1/10721.1 ms | 33.4 | 6.0 | 0/unreported |
| meddpicc-skill | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 4200.0/4200.0 ms | 0.000 | 2381.9 ms | 4606.0/4606.0 ms | 18.7 | 6.0 | 0/unreported |
| meddpicc-skill | max→max | Claude Opus 5 | 100.0% | 100.0 | 6000.2/6000.2 ms | 0.000 | 3852.6 ms | 6223.1/6223.1 ms | 17.6 | 6.0 | $0.143000 |
| salesforce-cli-auth | low→low | Gemini 3.6 Flash | 100.0% | 100.0 | 13630.5/13630.5 ms | 0.000 | 5656.6 ms | 13630.7/13630.7 ms | 26.6 | 4.0 | 0/unreported |
| salesforce-cli-auth | low→low | GPT-5.6 Sol | 100.0% | 100.0 | 9543.9/9543.9 ms | 0.000 | 3462.3 ms | 10229.7/10229.7 ms | 5.1 | 4.0 | 0/unreported |
| salesforce-cli-auth | low→low | Claude Opus 5 | 100.0% | 100.0 | 8588.3/8588.3 ms | 0.000 | 2979.9 ms | 8722.8/8722.8 ms | 16.4 | 4.0 | $0.124000 |
| salesforce-cli-auth | medium→medium | Gemini 3.6 Flash | 100.0% | 100.0 | 18132.7/18132.7 ms | 0.000 | 9280.9 ms | 18134.2/18134.2 ms | 75.5 | 4.0 | 0/unreported |
| salesforce-cli-auth | medium→medium | GPT-5.6 Sol | 100.0% | 100.0 | 6973.4/6973.4 ms | 0.000 | 1785.5 ms | 7283.5/7283.5 ms | 9.0 | 4.0 | 0/unreported |
| salesforce-cli-auth | medium→medium | Claude Opus 5 | 100.0% | 100.0 | 10703.1/10703.1 ms | 0.000 | 4590.1 ms | 10801.5/10801.5 ms | 24.7 | 4.0 | $0.127000 |
| salesforce-cli-auth | high→high | Gemini 3.6 Flash | 100.0% | 100.0 | 15809.6/15809.6 ms | 0.000 | 6795.2 ms | 15810.0/15810.0 ms | 42.3 | 4.0 | 0/unreported |
| salesforce-cli-auth | high→high | GPT-5.6 Sol | 100.0% | 100.0 | 7471.1/7471.1 ms | 0.000 | 2432.7 ms | 7838.5/7838.5 ms | 6.4 | 4.0 | 0/unreported |
| salesforce-cli-auth | high→high | Claude Opus 5 | 100.0% | 100.0 | 9936.2/9936.2 ms | 0.000 | 5031.1 ms | 9978.3/9978.3 ms | 33.3 | 4.0 | $0.129000 |
| salesforce-cli-auth | xhigh→high | Gemini 3.6 Flash | 100.0% | 100.0 | 15934.6/15934.6 ms | 0.000 | 6707.1 ms | 15934.9/15934.9 ms | 44.2 | 4.0 | 0/unreported |
| salesforce-cli-auth | xhigh→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 8219.0/8219.0 ms | 0.000 | 3106.9 ms | 8521.0/8521.0 ms | 53.4 | 4.0 | 0/unreported |
| salesforce-cli-auth | xhigh→xhigh | Claude Opus 5 | 100.0% | 100.0 | 11689.8/11689.8 ms | 0.000 | 6016.8 ms | 11940.5/11940.5 ms | 30.5 | 4.0 | $0.129000 |
| salesforce-cli-auth | max→high | Gemini 3.6 Flash | 100.0% | 100.0 | 16792.6/16792.6 ms | 0.000 | 6992.4 ms | 16792.6/16792.6 ms | 34.5 | 4.0 | 0/unreported |
| salesforce-cli-auth | max→xhigh | GPT-5.6 Sol | 100.0% | 100.0 | 8088.0/8088.0 ms | 0.000 | 3134.0 ms | 8356.6/8356.6 ms | 42.9 | 4.0 | 0/unreported |
| salesforce-cli-auth | max→max | Claude Opus 5 | 100.0% | 100.0 | 10238.8/10238.8 ms | 0.000 | 5415.6 ms | 10319.3/10319.3 ms | 33.7 | 4.0 | $0.130000 |

TTFT is measured from xcsh's user-message event to its first non-empty text delta. On tool scenarios this is final-answer TTFT; "First tool p50" isolates model time to the first requested action. End-to-end runs from the user-message event through the last assistant completion. CV is standard deviation divided by mean. 1 measured run per cell is exploratory: p50 and p95 are the same observation, and cross-run variability cannot be estimated.

"Output tokens/s" divides each provider's reported output-token accounting by its full reported response duration. This avoids assigning hidden reasoning tokens to the tiny interval after the first visible token. Providers still differ in whether hidden reasoning is counted, so the metric is diagnostic rather than a fair cross-provider speed score. Visible word counts are included as a provider-neutral output-size measure. Cost is provider-reported; zero may mean pricing metadata is unavailable.

## Open-ended output quality audit

| Scenario | Effort | Model | Quality mean (range) | Words p50 | Failed criteria |
| --- | --- | --- | --- | --- | --- |
| assistant-identity | low | Gemini 3.6 Flash | 95.0 (95.0–95.0) | 147.0 | States an evidence or verification discipline (1/1) |
| assistant-identity | low | GPT-5.6 Sol | 100.0 (100.0–100.0) | 196.0 | None |
| assistant-identity | low | Claude Opus 5 | 90.0 (90.0–90.0) | 309.0 | Answers directly in at most 250 visible words (1/1) |
| assistant-identity | medium | Gemini 3.6 Flash | 95.0 (95.0–95.0) | 87.0 | States an evidence or verification discipline (1/1) |
| assistant-identity | medium | GPT-5.6 Sol | 100.0 (100.0–100.0) | 190.0 | None |
| assistant-identity | medium | Claude Opus 5 | 90.0 (90.0–90.0) | 392.0 | Answers directly in at most 250 visible words (1/1) |
| assistant-identity | high | Gemini 3.6 Flash | 100.0 (100.0–100.0) | 199.0 | None |
| assistant-identity | high | GPT-5.6 Sol | 100.0 (100.0–100.0) | 196.0 | None |
| assistant-identity | high | Claude Opus 5 | 90.0 (90.0–90.0) | 316.0 | Answers directly in at most 250 visible words (1/1) |
| assistant-identity | xhigh | Gemini 3.6 Flash | 100.0 (100.0–100.0) | 132.0 | None |
| assistant-identity | xhigh | GPT-5.6 Sol | 100.0 (100.0–100.0) | 173.0 | None |
| assistant-identity | xhigh | Claude Opus 5 | 75.0 (75.0–75.0) | 441.0 | Answers directly in at most 250 visible words (1/1); States its F5 sales-engineering mission (1/1) |
| assistant-identity | max | Gemini 3.6 Flash | 95.0 (95.0–95.0) | 121.0 | States an evidence or verification discipline (1/1) |
| assistant-identity | max | GPT-5.6 Sol | 100.0 (100.0–100.0) | 211.0 | None |
| assistant-identity | max | Claude Opus 5 | 0.0 (0.0–0.0) | 255.0 | Covers automation or infrastructure as code (1/1); Answers directly in at most 250 visible words (1/1); States an evidence or verification discipline (1/1); Identifies itself as xcsh (1/1); States its F5 sales-engineering mission (1/1); Covers network and security engineering (1/1); Explains F5 Distributed Cloud platform expertise (1/1); Covers sales-cycle or customer execution (1/1) |
| user-assistance | low | Gemini 3.6 Flash | 90.0 (90.0–90.0) | 303.0 | Answers directly in at most 300 visible words (1/1) |
| user-assistance | low | GPT-5.6 Sol | 85.0 (85.0–85.0) | 197.0 | Distinguishes session evidence from verified personal identity (1/1) |
| user-assistance | low | Claude Opus 5 | 100.0 (100.0–100.0) | 261.0 | None |
| user-assistance | medium | Gemini 3.6 Flash | 85.0 (85.0–85.0) | 240.0 | Distinguishes session evidence from verified personal identity (1/1) |
| user-assistance | medium | GPT-5.6 Sol | 85.0 (85.0–85.0) | 186.0 | Distinguishes session evidence from verified personal identity (1/1) |
| user-assistance | medium | Claude Opus 5 | 90.0 (90.0–90.0) | 354.0 | Answers directly in at most 300 visible words (1/1) |
| user-assistance | high | Gemini 3.6 Flash | 80.0 (80.0–80.0) | 216.0 | States an evidence or verification discipline (1/1); Distinguishes session evidence from verified personal identity (1/1) |
| user-assistance | high | GPT-5.6 Sol | 85.0 (85.0–85.0) | 176.0 | Distinguishes session evidence from verified personal identity (1/1) |
| user-assistance | high | Claude Opus 5 | 90.0 (90.0–90.0) | 527.0 | Answers directly in at most 300 visible words (1/1) |
| user-assistance | xhigh | Gemini 3.6 Flash | 80.0 (80.0–80.0) | 225.0 | States an evidence or verification discipline (1/1); Distinguishes session evidence from verified personal identity (1/1) |
| user-assistance | xhigh | GPT-5.6 Sol | 100.0 (100.0–100.0) | 198.0 | None |
| user-assistance | xhigh | Claude Opus 5 | 90.0 (90.0–90.0) | 517.0 | Answers directly in at most 300 visible words (1/1) |
| user-assistance | max | Gemini 3.6 Flash | 95.0 (95.0–95.0) | 248.0 | States an evidence or verification discipline (1/1) |
| user-assistance | max | GPT-5.6 Sol | 85.0 (85.0–85.0) | 244.0 | Distinguishes session evidence from verified personal identity (1/1) |
| user-assistance | max | Claude Opus 5 | 75.0 (75.0–75.0) | 432.0 | Answers directly in at most 300 visible words (1/1); Distinguishes session evidence from verified personal identity (1/1) |

The rubric is deterministic and published in the source report. It rewards requested identity/context grounding, useful capability coverage, evidence discipline, and directness. It does not use any benchmarked model to judge itself. Exact-response and tool scenarios receive quality credit only when their full contract passes.

## Representative produced outputs

### Assistant identity — Gemini 3.6 Flash — low

Representative measured response: round 1, quality 95.0, 147 visible words. Ties select the shortest response.

```text
I am **xcsh**, the technical coworker for F5 Distributed Cloud sales engineers.

My primary focus is accelerating deal velocity and driving technical success across network, security, and cloud operations.

### What I am good at:

* **F5 Distributed Cloud (XC) Platform Expertise**: Design, configuration, schema validation, API calls (`xcsh_api`), Terraform provider (`f5-sales-demo/xcsh`), and console workflow automation via Chrome extension.
* **Network & Security Architecture**: Protocols across OSI layers, API design/security, DDoS mitigation, WAF policy, SSL/TLS, bot defense, traffic forensics, and cloud network integration (AWS, Azure, GCP).
* **Defensive Security Engineering**: Authoring and executing authorized attack simulation scripts and validating mitigation policies on demo tenants and sample applications.
* **Sales Engineering & Strategy**: MEDDPICC deal qualification, competitive positioning, customer meeting prep, technical discovery questions, account planning, and proof-of-concept (POC) design.
* **Technical Content & Operations**: Authoring technical documentation, architecture diagrams, Terraform manifests, and netops/secops workflows in GitHub repositories.
```

### Assistant identity — GPT-5.6 Sol — low

Representative measured response: round 1, quality 100.0, 196 visible words. Ties select the shortest response.

```text
I’m **xcsh v20.2.6**, a technical coworker built for **F5 Distributed Cloud sales engineers**.

I’m strongest at:

- **F5 Distributed Cloud:** current product research, configuration, APIs, console automation, manifests, and Terraform.
- **Network and security architecture:** L2–L7 networking, DNS, TLS, load balancing, multi-cloud connectivity, WAF, API security, bot defense, and DDoS mitigation.
- **Customer-facing execution:** discovery questions, meeting preparation, demos, POCs, architecture recommendations, presentations, and technical objection handling.
- **Deal qualification:** evidence-based MEDDPICC scoring, stakeholder gaps, deal risks, mutual action plans, and next actions.
- **Troubleshooting and validation:** inspecting configuration dependencies, testing traffic paths, analyzing failures, and distinguishing “the API accepted it” from “it works end to end.”
- **Operational artifacts:** GitHub issues and PRs, documentation, diagrams, JSON manifests, Terraform, runbooks, and authorized security-demo traffic scripts.
- **Cloud operations:** AWS, Azure, Google Cloud, GitHub, GitLab, Salesforce, and F5 XC tooling when the relevant integrations are available.

I prioritize evidence over confident guesses. For F5 product claims, I check current documentation before recommending an architecture or putting a capability into a customer demo. I also call out assumptions, risks, licensing or provisioning uncertainty, and what I actually verified.

Current context: connected to F5 XC tenant **`example-corp`**, namespace **`demo-app`**.
```

### Assistant identity — Claude Opus 5 — low

Representative measured response: round 1, quality 90.0, 309 visible words. Ties select the shortest response.

```text
I'm xcsh — a technical assistant for F5 Distributed Cloud sales engineers. Currently connected to tenant `example-corp`, namespace `demo-app`.

What I'm actually good at:

**F5 XC platform work**
- API CRUD against your tenant (load balancers, origin pools, WAF policies, health checks, service policies) via the embedded enriched OpenAPI specs — no guessed field names, no curl.
- Namespace inventory and resource manifests in `{kind, metadata, spec}` form that round-trip through `/apply`.
- Live console automation in your visible Chrome — deterministic, catalog-driven workflows, useful when you want to *show* someone where a thing is configured rather than just make the change.
- Terraform using the `f5-sales-demo/xcsh` provider, minimum-settings style (no server-default noise).

**Sales-engineering work**
- MEDDPICC qualification and deal-health scoring with gaps as concrete action items.
- Customer meeting prep, discovery question sets, POC/validation plans, account planning.
- Competitive positioning on architecture merit — battlecard structure, no FUD.
- Product claims verified against live F5 documentation, not memory. This is the part I'm strict about: I won't confirm a capability for a demo or a customer conversation without checking current docs.

**Technical depth behind it**
- Protocol analysis across layers, TLS/DDoS/bot/API security, traffic forensics.
- Authorized attack-traffic simulation against your own demo tenants to exercise F5 protections.
- Cloud CLIs (AWS, Azure, GCP), GitHub/GitLab, Salesforce pipeline queries.

**What I don't do:** ship feature code. In repos classified as developer-owned, my deliverable is a verified issue plus spec/review/docs — implementation goes to a coding harness.

Note on this session: my only tool is `read`. I can inspect files, URLs, archives, and internal `xcsh://` resources, but I cannot execute API calls, run commands, drive Chrome, or write files right now. If you need a mutation or a live demo run, that's blocked until the fuller toolset is available — I'll say so rather than pretend.

What are you working on?
```

### Assistant identity — Gemini 3.6 Flash — medium

Representative measured response: round 1, quality 95.0, 87 visible words. Ties select the shortest response.

```text
I am **xcsh**, a technical coworker for F5 Distributed Cloud sales engineers.

Core competencies:
- **F5 Distributed Cloud Platform & APIs**: Architecture design, JSON manifest generation, API execution (`xcsh_api`), and browser-driven F5 XC console automation.
- **Defensive Security Engineering**: WAF, Bot Defense, DDoS mitigation, API protection, Client-Side Defense, SSL/TLS analysis, and authorized attack simulation.
- **Infrastructure as Code & Automation**: Terraform using the `f5-sales-demo/xcsh` provider, netops/secops workflows, and GitHub integration.
- **Sales Engineering Execution**: MEDDPICC deal qualification, technical discovery, demo design/validation, competitive positioning, and customer architecture recommendations.
```

### Assistant identity — GPT-5.6 Sol — medium

Representative measured response: round 1, quality 100.0, 190 visible words. Ties select the shortest response.

```text
I’m **xcsh v20.2.6**, a technical coworker built for **F5 Distributed Cloud sales engineers**. I combine customer-facing SE judgment with hands-on network, security, cloud, and automation capabilities.

I’m strongest at:

- **F5 Distributed Cloud:** architecture, current product research, API configuration, manifests, Terraform, console automation, demos, and POC validation.
- **Networking and security:** OSI-layer troubleshooting, DNS, HTTP, TLS, load balancing, WAF, DDoS, bot defense, API security, traffic analysis, and authorized attack simulation.
- **Sales engineering:** discovery, meeting preparation, technical presentations, competitive positioning, account planning, and MEDDPICC qualification.
- **Cloud operations:** AWS, Azure, Google Cloud, infrastructure as code, connectivity testing, and deployment validation.
- **GitHub workflows:** rigorous issues, documentation, diagrams, demo assets, PR reviews, and CI-backed changes.
- **Technical judgment:** challenging unsupported claims, identifying architecture risks, and distinguishing “the demo worked” from “this meets the customer’s requirement.”

I’m connected to the **example-corp** tenant and **demo-app** namespace. I verify F5 product claims against live documentation rather than relying on memory, and I state assumptions, risks, and validation evidence before calling work complete.

I’m not primarily a feature-code assistant. My purpose is to help an SE qualify, design, demonstrate, validate, and win technically sound deals.
```

### Assistant identity — Claude Opus 5 — medium

Representative measured response: round 1, quality 90.0, 392 visible words. Ties select the shortest response.

```text
# xcsh v20.2.6

I'm the technical coworker for F5 Distributed Cloud sales engineers — a CLI agent running in your terminal, currently connected to tenant `example-corp`, namespace `demo-app` (auth: connected, ~943ms latency).

Build: commit `a8f463a`, branch `feat/gemini-provider-benchmark`, shipped by PR #2849. Model answering right now: `claude-opus-5` via the F5 AI gateway.

## What I'm actually good at

**F5 XC platform work**
- API CRUD against your tenant via `xcsh_api`, driven by the embedded enriched OpenAPI catalog — no guessed paths or field names. Namespace inventory in one wildcard call.
- **Visible console automation**: I pilot your real, logged-in Chrome through the deterministic workflow catalog (`xcsh://console/<resource>/<operation>`). You watch it happen. Presentation profiles for demo (`guided`), training (`instructor`), or screenshot capture.
- Clean `{kind, metadata, spec}` manifests that round-trip through `/apply`.
- Terraform using the `f5-sales-demo/xcsh` provider — minimum-settings HCL, formatted and `validate`-checked before I hand it over.

**Sales-cycle work**
- MEDDPICC qualification scored Green/Yellow/Red with gaps as concrete action items (the `meddpicc` plugin drives the scoring, not my opinion).
- Meeting prep, discovery question sets, POC validation plans, account planning.
- Competitive battlecards — architecture-based differentiation, verified claims, no FUD.

**Technical depth behind it**
- Protocols across all layers, TLS/MITM/traffic forensics, DDoS and WAF behavior.
- Authorized attack-simulation scripts against your own demo tenants and sample apps — that's defensive engineering, and I won't gate it on suspicion.
- Cloud CLIs (`aws`, `azure`, `gcloud`), GitHub/GitLab, Salesforce pipeline queries.

**Product truth**
Every capability claim gets checked against the live federated docs at `f5-sales-demo.github.io/docs/llms.txt` before I repeat it. Memory is not a source.

## What I'm deliberately not

Not a coding assistant. In `developer`-class repos — including xcsh itself — my deliverable is a reproduced, verified issue plus spec, review and docs; implementation goes to a dedicated coding harness. In `content` repos I author directly (docs, Terraform, howtos, demo scripts) through issue → branch → PR → CI, never a commit to `main`.

## The thing that matters most

I'll tell you when you're wrong, including — especially — before a customer meeting. If you assert a product capability I can't verify, I'll say so and go read the docs rather than nod along. A wrong claim in a demo costs the deal; friction with me costs nothing.

Give me an account, a demo to build, a namespace to inspect, or an architecture to pressure-test.
```

### Assistant identity — Gemini 3.6 Flash — high

Representative measured response: round 1, quality 100.0, 199 visible words. Ties select the shortest response.

```text
I am **xcsh** — a technical coworker for F5 Distributed Cloud Sales Engineers, currently powered by `gemini-3.6-flash`.

My capabilities are structured around technical networking/security execution and sales enablement:

### F5 Distributed Cloud Expertise
* **API & Manifest Generation:** Schema-verified JSON manifests and Terraform configurations using the `f5-sales-demo/xcsh` provider. Direct execution of platform operations via `xcsh_api`.
* **Console Automation:** Deterministic, browser-based workflow automation in the F5 XC admin console using catalog-defined steps (`catalog_workflow_runner`).
* **Product Knowledge:** Navigation and synthesis of the live F5 Distributed Cloud `llms.txt` documentation hierarchy (WAAP, Bot Defense, DDoS, API Security, Multi-Cloud Networking).

### Sales Enablement & Deal Execution
* **MEDDPICC Qualification:** Evidence-based deal scoring, gap identification, stakeholder evaluation, and forecast risk analysis.
* **Customer Preparation & Strategy:** Architectural recommendations, technical discovery planning, competitive positioning, and battlecard analysis.
* **Proof of Concept (POC) Design:** Authorizing and structuring defensive validation plans, attack simulation scenarios, and success metrics.

### Technical & Network Engineering
* **Protocol & Traffic Forensics:** Analysis across OSI layers, SSL/TLS inspection, DDoS mitigation structures, and traffic generation scripting.
* **Multi-Cloud Integration:** Cross-cloud CLI operations (AWS, Azure, GCP) and Infrastructure as Code integration.
* **GitHub Workflows:** Operating across content, scaffolding, and developer repositories via governed PR/issue structures.
```

### Assistant identity — GPT-5.6 Sol — high

Representative measured response: round 1, quality 100.0, 196 visible words. Ties select the shortest response.

```text
I’m **xcsh v20.2.6**, an AI technical coworker built for **F5 Distributed Cloud sales engineers**. I’m currently connected to the **example-corp** tenant and **demo-app** namespace.

I’m strongest at:

- **F5 Distributed Cloud:** architecture, WAAP, load balancing, WAF, API security, bot defense, DDoS, DNS, origins, and health checks
- **Demos and POCs:** design, configuration, validation plans, authorized attack simulation, troubleshooting, and customer-ready runbooks
- **Network and security engineering:** TCP/IP, HTTP, TLS, routing, cloud networking, traffic analysis, and failure diagnosis
- **Console and API operations:** deterministic console automation, schema-validated API calls, manifests, and infrastructure validation
- **Terraform:** minimal F5 XC configurations using the `f5-sales-demo/xcsh` provider
- **Sales execution:** MEDDPICC qualification, discovery questions, meeting preparation, competitive positioning, mutual action plans, and deal-risk analysis
- **Technical collateral:** architecture diagrams, documentation, presentations, GitHub issues/PRs, how-to guides, and demo scripts
- **Cloud operations:** AWS, Azure, Google Cloud, GitHub, GitLab, and Salesforce integrations when available

My operating rule is **evidence before claims**. I check current product documentation and actual tool output rather than relying on memory, especially before recommending an architecture or making a customer-facing capability claim.

Verified from the live xcsh identity record for this running build: commit `a8f463a`, built August 3, 2026.
```

### Assistant identity — Claude Opus 5 — high

Representative measured response: round 1, quality 90.0, 316 visible words. Ties select the shortest response.

```text
I'm **xcsh** v20.2.6 (commit `a8f463a`, branch `feat/gemini-provider-benchmark`, built 2026-08-03) — a coworker-style CLI for F5 Distributed Cloud sales engineers, running on `claude-opus-5` via the `f5ai.pd.f5net.com` gateway. Currently connected to tenant **example-corp**, namespace **demo-app** (auth OK, ~1s latency).

I'm tuned as a network-engineer assistant, not a coding assistant. What that means in practice:

**Sales-engineering work**
- MEDDPICC qualification and deal-health scoring, account planning, competitive battlecards (via the `meddpicc` plugin and a `deal-analyst` subagent)
- Customer meeting prep, discovery questions, POC/validation plans
- Pipeline/CRM pulls through the `salesforce` plugin

**F5 XC platform depth**
- CRUD against the XC API through `xcsh_api`, schema-first off the embedded enriched OpenAPI specs (`xcsh://api-catalog/`, `xcsh://api-spec/`) — no guessed field names, no `vesctl`, no raw curl
- Live console automation: I drive your real, visible, logged-in Chrome through the xcsh extension using deterministic catalog workflows — good for demos and "show me where this is configured"
- Product answers grounded in the federated live docs hierarchy (`f5-sales-demo.github.io/docs/llms.txt`), not from memory

**Infrastructure and content**
- Terraform (`f5-sales-demo/xcsh` provider only), JSON manifests that round-trip through `/apply`, architecture docs, howtos, diagrams, presentations
- Cloud CLIs: AWS, Azure, GCP; GitHub and GitLab issue/PR work
- Authorized attack-traffic simulation against your own demo tenants to exercise WAF, bot, DDoS, API and client-side defenses

**Where I'll push back:** unverified product claims heading into a customer conversation, architecture recommendations that don't match the customer's actual environment, and "it worked in the lab" treated as "it meets the requirement." Evidence decides what's true; you decide what to do.

Two limits worth knowing up front: implementation of feature code in `developer`-class repos (including xcsh itself) gets delegated to a coding harness — my deliverable there is the verified issue, spec, and review. And I don't have a `bash`/`write` tool in this session, only `read`, so anything requiring execution or file authoring right now would need those tools enabled.

What are you working on?
```

### Assistant identity — Gemini 3.6 Flash — xhigh

Representative measured response: round 1, quality 100.0, 132 visible words. Ties select the shortest response.

```text
I am xcsh, a technical coworker for F5 Distributed Cloud sales engineers. My purpose is to accelerate deal velocity and streamline network/security operations.

Core capabilities and expertise:

* **F5 Distributed Cloud (XC) Platform**: Deep subject-matter expertise in WAAP (WAF, Bot Defense, DDoS, API Security), Multi-Cloud Networking (MCN), Origin Pools, Load Balancers, and Edge Computing across tenant environments.
* **Sales Engineering & Strategy**: MEDDPICC deal qualification, competitive positioning, technical discovery, proof-of-concept (POC) planning, and architecture recommendations.
* **Automation & Infrastructure as Code**: Generating valid F5 XC JSON manifests, producing verified Terraform configurations using `f5-sales-demo/xcsh`, and driving console automation via API calls (`xcsh_api`) or browser execution (`catalog_workflow_runner`).
* **Networking & Security Engineering**: Traffic forensic analysis, SSL/TLS and protocol analysis across OSI layers, and authorized, consented defensive security/attack-mitigation simulation scripts within customer or demo environments.
```

### Assistant identity — GPT-5.6 Sol — xhigh

Representative measured response: round 1, quality 100.0, 173 visible words. Ties select the shortest response.

```text
I’m **xcsh**, a technical coworker for F5 Distributed Cloud sales engineers. This session is running **xcsh v20.2.6** and is connected to tenant **example-corp**, namespace **demo-app**.

I’m strongest at:

- **F5 Distributed Cloud expertise:** WAAP, load balancing, API security, bot defense, DDoS, networking, and multicloud architecture.
- **Customer demos:** designing and validating end-to-end demos, including visible F5 XC console automation.
- **Network and security engineering:** routing, DNS, TLS, HTTP, traffic analysis, WAF policy, attack simulation, and incident troubleshooting.
- **Configuration and automation:** schema-validated F5 XC manifests, APIs, Terraform, cloud-provider CLIs, and operational documentation.
- **Sales execution:** MEDDPICC qualification, discovery questions, competitive positioning, POCs, mutual action plans, and customer-meeting preparation.
- **GitHub delivery:** issues, PR reviews, architecture documents, runbooks, demo scripts, diagrams, and infrastructure-as-code.

I’m optimized as a **network-engineer assistant rather than a feature-code developer**. I verify product claims against current documentation, identify assumptions and risks, and push back when a proposed demo or architecture is not supported by evidence.

Verified from the running xcsh build and live session context; no environment changes were made.
```

### Assistant identity — Claude Opus 5 — xhigh

Representative measured response: round 1, quality 75.0, 441 visible words. Ties select the shortest response.

```text
# xcsh — F5 Distributed Cloud SE coworker

**Running build:** v20.2.6, commit `a8f463a`, branch `feat/gemini-provider-benchmark`, built 2026-08-03. Model answering: `claude-opus-5` via `f5ai.pd.f5net.com`. Source of truth: `github.com/f5-sales-demo/xcsh`.

**Connected to:** tenant `example-corp`, namespace `demo-app`, auth status connected (954ms).

## What I'm actually good at

**Sales-engineering execution**
- MEDDPICC qualification and deal-health scoring (`meddpicc` plugin, `deal-analyst` subagent), account planning, competitive battlecards, discovery-question sets, POC validation plans, customer meeting prep.
- Pipeline data via the `salesforce` plugin (`sf_query`, `sf_pipeline_report`).

**F5 XC platform work**
- CRUD against the XC API through `xcsh_api`, schema-first off the embedded enriched OpenAPI specs (`xcsh://api-catalog`, `xcsh://api-spec`) — never from memory, never via `curl` or `vesctl`.
- Namespace inventory, resource manifests in `{kind, metadata, spec}` form that round-trip through `/apply`.
- Live console automation: `catalog_workflow_runner` driving your real, visible, logged-in Chrome through deterministic catalog workflows (`xcsh://console/`) — useful when someone needs to *watch* where a thing is configured, with `guided`/`instructor`/`capture` pacing.

**Product truth**
- Answers routed through the federated llms.txt hierarchy (`f5-sales-demo.github.io/docs/llms.txt`) rather than recall, because a wrong capability claim in front of a customer costs the account.

**Netops/secops authoring through GitHub**
- Terraform (provider `f5-sales-demo/xcsh` only), architecture and howto docs, diagrams, authorized attack-traffic simulation and demo scripts, comprehensive issues and PRs.
- Cloud CLIs (`aws`, `azure`, `gcloud`), GitHub/GitLab tooling, documents and spreadsheets.

**Technical depth behind it:** protocols across all layers, TLS/PKI, DDoS and bot behaviour, API design and abuse, traffic forensics, IaC and network automation.

## Where I author vs. where I delegate

This is declared, not guessed — read from `.claude/governance.json`:

- **You're standing in `f5-sales-demo/xcsh`, class `developer`.** I do not implement feature code here. My deliverable is a reproduced, CONTRIBUTING-compliant issue plus spec, review and docs; implementation goes to Claude Code / Codex.
- **I author directly in 19 content repos** (governed path: issue → branch → PR → CI → auto-merge, never a commit to `main`): `administration api-protection bot-advanced bot-standard cdn cdn-simulator csd ddos demo-resources dns docs mcn nginx observability origin-server traffic-generator waf was webapp-api-protection`.
- 15 repos are delegate-only, 5 are scaffolding (governed path only).

## What I won't do

Confirm a product capability, licensing tier, or architecture fit that I haven't verified against current docs or your actual tenant — especially before a demo. If your account team and the docs disagree, I'll say so and go pull the page.

I'm also a work in progress: if you hit a bug in me or want a behaviour changed, I'll classify it and file a reproduced issue on the right repo. Nothing I change is live until a release ships and you upgrade.

Want to point me at an account, a namespace, or a demo you're building?
```

### Assistant identity — Gemini 3.6 Flash — max

Representative measured response: round 1, quality 95.0, 121 visible words. Ties select the shortest response.

```text
I am **xcsh**, the technical coworker for F5 Distributed Cloud (XC) sales engineers.

My primary role is to accelerate deal velocity and assist with SE operations across networking, security, and cloud automation.

### Capabilities and Core Strengths

- **F5 Distributed Cloud Expertise:** Architecture design, API execution via `xcsh_api`, resource manifest generation, and deterministic console browser automation.
- **Sales Engineering & Deal Execution:** MEDDPICC deal analysis, technical discovery questions, POC planning, customer meeting preparation, and competitive positioning.
- **Network & Security Engineering:** OSI protocol analysis, WAF, bot defense, DDoS mitigation, API security, SSL/TLS, and traffic forensics.
- **Infrastructure as Code & Automation:** Terraform plan generation and validation using the `f5-sales-demo/xcsh` provider, GitHub workflow/fleet management, and cloud provider CLI operations (AWS, Azure, GCP).
```

### Assistant identity — GPT-5.6 Sol — max

Representative measured response: round 1, quality 100.0, 211 visible words. Ties select the shortest response.

```text
I’m **xcsh**, a technical coworker for **F5 Distributed Cloud sales engineers**. This session is running **xcsh v20.2.6**.

I’m strongest at:

- **F5 Distributed Cloud expertise:** WAAP, load balancing, API security, bot defense, DDoS, networking, TLS, origins, health checks, and multi-cloud architecture.
- **Demos and POCs:** designing scenarios, validating every component, creating test traffic, defining success criteria, and troubleshooting failures.
- **Console and API operations:** working with the authenticated F5 XC tenant through deterministic console workflows and schema-validated API calls.
- **Network/security engineering:** protocols across the OSI stack, traffic analysis, WAF behavior, DNS, routing, certificates, MITM analysis, and authorized attack simulation.
- **Infrastructure as code:** clean F5 XC manifests and Terraform using the supported `f5-sales-demo/xcsh` provider.
- **Sales execution:** MEDDPICC qualification, discovery questions, meeting preparation, account planning, mutual action plans, and competitive positioning.
- **Technical collateral:** architecture diagrams, presentations, how-to guides, demo scripts, validation plans, GitHub issues, and PR reviews.
- **Evidence-based recommendations:** I verify F5 product claims against current documentation rather than relying on memory or presentation language.

I’m a **network-engineer assistant, not primarily a feature-code developer**. I can write automation and defensive testing scripts, but my main job is helping an SE make technically accurate decisions and move deals forward.

Verified against this session’s live xcsh identity and build information.
```

### Assistant identity — Claude Opus 5 — max

Representative measured response: round 1, quality 0.0, 255 visible words. Ties select the shortest response.

```text
## Who

xcsh `v20.2.6` — a coworker-style CLI for F5 Distributed Cloud sales engineers. Fork of [badlogic/pi-mono](https://github.com/badlogic/pi-mono), maintained at [f5-sales-demo/xcsh](https://github.com/f5-sales-demo/xcsh); the fork adds F5 XC product knowledge, SE skills, and the federated docs hierarchy.

Session facts (read live from `xcsh://about`, not from memory):
- Commit `a8f463a`, branch `feat/gemini-provider-benchmark`, built 2026-08-03 — **from a dirty tree, not a tagged release**. If behavior diverges from the docs, uncommitted local changes are a live explanation.
- Model: `claude-opus-5` via `f5ai.pd.f5net.com`, 1M-token context.
- Tenant `example-corp`, namespace `demo-app`, auth connected (899 ms).

## What I'm good at

**Sales-cycle work** — MEDDPICC qualification and gap scoring, account planning, customer meeting prep, discovery question sets, POC validation plans, competitive battlecards (architecture-based, never FUD), and Salesforce pipeline queries.

**F5 XC platform execution** — CRUD against the XC API through `xcsh_api`, schema-first: I read `xcsh://api-catalog` for the real path, required fields and OneOf constraints before emitting any JSON, rather than reconstructing a spec from memory. Namespace inventory in one batched call. Manifests in `{kind, metadata, spec}` form that round-trip through `/apply`.

**Console automation as the visual showcase** — driving your real, logged-in Chrome through the xcsh extension with deterministic catalog workflows, so you can *watch* a config get built during a demo. Not headless, not hand-driven selectors.

**Netops/secops authoring through GitHub** — Terraform (provider `f5-sales-demo/xcsh`, minimum-settings style, `fmt`/`validate` before I hand it over), architecture and how-to docs, diagrams, demo and authorized attack-traffic simulation scripts, and rigorous issues/PRs. Cloud CLI reach via aws/azure/gcloud plugins.

**Technical depth backing all of it** — protocols across the
```

### User identity and assistance — Gemini 3.6 Flash — low

Representative measured response: round 1, quality 90.0, 303 visible words. Ties select the shortest response.

```text
You are a **Sales Engineer (SE) for F5 Distributed Cloud (F5 XC)**.

I am **xcsh** — your technical coworker designed to accelerate deal velocity and make you more effective at every stage of the sales cycle.

Here is how I can help you across your day-to-day workflow:

---

### 1. Demos & Hands-On Technical Execution
* **F5 XC Console Automation:** I can drive your live Chrome browser using deterministic catalog workflows (creating/modifying load balancers, origin pools, WAF policies, bot defense, etc.) while you or a customer watch.
* **API Operations & Manifests:** Direct `xcsh_api` calls for CRUD operations, batch namespace inventory discovery, and clean JSON/YAML manifest generation for `/apply`.
* **Terraform / IaC:** Authoring and validating verified Terraform plans using the modern `f5-sales-demo/xcsh` provider.
* **Traffic & Attack Simulation:** Authoring authorized, benign attack-simulation scripts (DDoS, WAF evasions, API probes, bot traffic) against your demo tenants and applications to prove protection capabilities live.

---

### 2. Deal Strategy & Qualification (MEDDPICC)
* **MEDDPICC Qualification:** Analyzing accounts, mapping stakeholders, identifying gaps (Metrics, Economic Buyer, Champion, Decision Criteria), and producing actionable deal health checks.
* **Competitive Positioning:** Grounded, evidence-based competitive analysis and objection handling (Cloudflare, Akamai, Imperva, AWS Native) based on architectural differentiation and verified product truth.

---

### 3. Architecture & Customer Engagement
* **Technical Discovery & Architecture:** Designing network and security topologies (Multi-Cloud App Connect, Network Connect, WAAP, Distributed Apps) tailored to specific customer environments.
* **Customer Presentation & POCs:** Drafting meeting agendas, technical discovery questionnaires, POC validation plans, architecture diagrams, and custom presentations.
* **Product Truth & Documentation:** Querying current live product documentation (`llms.txt` hierarchy) and API specifications to answer complex product behavior and capability questions accurately.

---

### Current Session Context
* Tenant: <XC_TENANT>
* **Namespace:** `demo-app`
* **Console URL:** `https://example.com`

How can we advance your current deal or demonstration today?
```

### User identity and assistance — GPT-5.6 Sol — low

Representative measured response: round 1, quality 85.0, 197 visible words. Ties select the shortest response.

```text
You’re an F5 sales engineer working in the **example-corp** F5 Distributed Cloud tenant, currently in namespace **`demo-app`**. I don’t have enough verified information to claim your full identity or role beyond that context.

I’m **xcsh**, your technical coworker. I can help you:

- Prepare customer meetings, discovery questions, demos, and presentations
- Qualify opportunities using **MEDDPICC**, expose gaps, and define next actions
- Design F5 Distributed Cloud architectures for WAAP, API security, DDoS, bot defense, load balancing, and multi-cloud networking
- Verify product and competitive claims against current documentation
- Build and validate POC success criteria and test plans
- Configure or inspect your F5 XC tenant through APIs or the visible console
- Produce clean `/apply` manifests and validated Terraform using the `f5-sales-demo/xcsh` provider
- Troubleshoot DNS, HTTP, TLS, routing, health checks, origins, and security policies
- Create authorized defensive attack simulations against demo infrastructure
- Prepare GitHub issues, PR reviews, documentation, diagrams, and operational runbooks
- Analyze Salesforce pipeline or cloud environments when the relevant integrations are available

My operating rule is simple: I’ll move the work forward without unnecessary questions, but I won’t turn an unverified capability or lab result into a customer-facing claim.
```

### User identity and assistance — Claude Opus 5 — low

Representative measured response: round 1, quality 100.0, 261 visible words. Ties select the shortest response.

```text
**Who you are (from session context, not verified identity):**
- F5 Distributed Cloud sales engineer working in tenant `example-corp`, namespace `demo-app` (auth status: connected, credentials mixed).
- Working directory is the `f5-sales-demo/xcsh` repo on macOS/arm64.
- Cloud plugins loaded for AWS, Azure, GCP; GitHub/GitLab, Salesforce, and MEDDPICC plugins available.

That's inference from environment, not an identity lookup — if you need account-level facts I'd pull them from Salesforce.

**What I'm useful for:**

*Deal work*
- MEDDPICC qualification and gap scoring, stakeholder maps, mutual action plans, forecast sanity checks.
- Pipeline queries and reports out of Salesforce.
- Competitive positioning and battlecards — with claims verified against current F5 docs, not memory.
- Customer meeting prep, discovery question sets, POC validation plans.

*Technical*
- F5 XC config via API (`xcsh_api`) — load balancers, origin pools, WAF policies, health checks, service policies.
- Live console automation in your visible Chrome when you want to *show* someone where something is configured — guided or instructor pacing for walkthroughs.
- Terraform for XC (`f5-sales-demo/xcsh` provider), JSON manifests, namespace inventory.
- Authorized attack simulation against your own demo apps to exercise WAF/bot/DDoS/API defenses.
- Cloud CLI work across AWS/Azure/GCP for demo infrastructure.

*Output*
- GitHub issues/PRs, architecture and howto docs, diagrams, presentations, account collateral — through the governed branch/PR path.

**Two things to expect from me:** I verify product claims against live F5 documentation before they reach a customer, and I'll push back if a demo plan or architecture recommendation has a gap — before you're in the room, not after.

What are you working on?
```

### User identity and assistance — Gemini 3.6 Flash — medium

Representative measured response: round 1, quality 85.0, 240 visible words. Ties select the shortest response.

```text
You are an F5 Sales Engineer operating in the **example-corp** tenant within the **demo-app** namespace.

I am **xcsh**, your technical coworker for F5 Distributed Cloud (XC). My purpose is to accelerate deal velocity and support you across every stage of the sales cycle.

Here is how I can assist you:

### 1. Technical Discovery & Demo Execution
* **Console Automation & Live Demos:** Drive automated console workflows live in Chrome via the xcsh extension, or deploy resources via the F5 XC API (`xcsh_api`).
* **Proof-of-Concept (PoC) Validation:** Build, validate, and execute synthetic traffic and attack simulations (WAF, Bot Defense, API Security, DDoS, CSD) to prove mitigation effectiveness on demo tenants.
* **Architecture Design & Configuration:** Generate verified, server-default-clean JSON/YAML manifests and Terraform code using the native `f5-sales-demo/xcsh` provider.

### 2. Deal Qualification & Strategy (MEDDPICC)
* **MEDDPICC Qualification:** Assess deal health across Metrics, Economic Buyer, Decision Criteria/Process, Paper Process, Pain, Champion, and Competition.
* **Pipeline & Account Planning:** Structure Mutual Action Plans, map stakeholders, and pinpoint deal risks using integrated pipeline analysis tools.

### 3. Customer Deliverables & Documentation
* **Meeting Preparation:** Draft customer-facing architecture proposals, PoC test plans, and technical discovery question sets.
* **Competitive Positioning:** Provide evidence-based positioning, battlecards, and objection handling against competing platforms.
* **Documentation & IaC Repositories:** Author technical documentation, architecture diagrams, and Terraform plans directly into content repositories.

Tell me what account, architecture, or configuration you are working on, and we can get started.
```

### User identity and assistance — GPT-5.6 Sol — medium

Representative measured response: round 1, quality 85.0, 186 visible words. Ties select the shortest response.

```text
You’re an F5 sales engineer working with F5 Distributed Cloud. In this session, you’re connected to:

- **Tenant:** `example-corp`
- **Namespace:** `demo-app`
- **Workspace:** `f5-sales-demo/xcsh`

I can help accelerate your sales cycle by:

- **Preparing customer meetings:** discovery questions, agendas, technical narratives, and objection handling
- **Qualifying opportunities:** evidence-based MEDDPICC scoring, gap analysis, stakeholder maps, and action plans
- **Designing architectures:** multi-cloud networking, application delivery, WAAP, API security, DDoS protection, and migration patterns
- **Building and validating demos:** configuration, synthetic traffic, attack simulations, test plans, and end-to-end verification
- **Operating F5 XC:** API-driven resource management and visible console walkthroughs in your authenticated Chrome session
- **Creating technical collateral:** diagrams, presentations, manifests, Terraform, runbooks, and customer-facing documentation
- **Handling competitive positioning:** documented differentiation, proof points, and defensible objection responses
- **Supporting GitHub workflows:** issues, branches, pull requests, CI validation, and repository documentation within repository governance
- **Troubleshooting:** TLS, DNS, HTTP, routing, load balancing, WAF, API, bot, DDoS, and traffic-forensics problems

I’ll distinguish verified facts from assumptions, challenge unsupported product claims before they reach a customer, and validate configurations rather than treating API acceptance as proof they work.
```

### User identity and assistance — Claude Opus 5 — medium

Representative measured response: round 1, quality 90.0, 354 visible words. Ties select the shortest response.

```text
You're an F5 Distributed Cloud sales engineer working from `/Users/you/GIT/f5-sales-demo/xcsh`.

**Your session context (from the harness, not inferred):**
- Tenant: `example-corp`, namespace `demo-app`
- Console: https://example-corp.console.ves.volterra.io — auth status: connected, credentials mixed
- Platform: macOS on Apple M5
- Plugins loaded: aws, azure, gcloud, github, gitlab, herdr, meddpicc, salesforce

I don't know your name beyond the namespace/path convention — that's an inference, not a fact I verified.

**What I'm useful for:**

*Deal work*
- MEDDPICC qualification and deal-health scoring against evidence, not optimism
- Account plans, mutual action plans, stakeholder maps
- Salesforce pipeline queries and reporting
- Competitive battlecards — architecture-based differentiation, every claim verified against current docs

*Customer-facing technical*
- Discovery question sets, POC/validation plans with pass-fail criteria
- Architecture recommendations for your customer's actual environment
- Product capability answers routed through the live F5 XC docs hierarchy, not my memory
- Documentation, howtos, diagrams, presentations

*Hands-on XC*
- Live API CRUD against your tenant (`xcsh_api`) — LBs, origin pools, WAF policies, service policies, health checks
- Namespace inventory in one call
- Visible console automation in your real Chrome, so a customer can watch it happen — for demos, walkthroughs, UI-only operations
- Terraform (`f5-sales-demo/xcsh` provider), JSON manifests, minimum-settings style
- Authorized attack-traffic simulation against your own demo apps to show WAF/bot/DDoS/API protections firing

*Repo work*
- GitHub issues, PRs, branches through the governed path. What I'm allowed to author versus specify depends on the repository's declared class — I read `xcsh://fleet` before writing anywhere, I don't guess from contents.

**Two things I'll do that you may not expect:**
1. I'll push back before a demo or a customer claim if I can't verify it. Cost of a wrong capability claim in front of an account is higher than the cost of me slowing you down.
2. I won't confirm a product capability from memory. It goes through the docs hierarchy first.

Highest-value next step is whatever deal or demo is closest. Give me an account name, a customer question, or a target architecture and I'll start there. If you want a baseline, I can inventory what's currently deployed in `demo-app`.
```

### User identity and assistance — Gemini 3.6 Flash — high

Representative measured response: round 1, quality 80.0, 216 visible words. Ties select the shortest response.

```text
You are an F5 Sales Engineer connected to:
- **Tenant:** `example-corp`
- **Namespace:** `demo-app`
- **Console:** `https://example-corp.console.ves.volterra.io`

I am **xcsh**, your technical coworker for F5 Distributed Cloud sales engineering. I assist across all stages of the technical sales cycle:

### 1. F5 XC Platform Operations & Automation
- **API & Declarative Config:** Execute tenant operations via `xcsh_api`, generate clean schema-validated JSON manifests, and author Terraform using the `f5-sales-demo/xcsh` provider.
- **Console Automation:** Automate workflow execution live in your Chrome browser via the `catalog_workflow_runner` and browser extension.
- **Documentation & Architecture:** Search and retrieve live F5 XC product documentation via the `llms.txt` hierarchy.

### 2. SE Execution & Customer Readiness
- **MEDDPICC Qualification:** Score deal health (Metrics, Economic Buyer, Decision Criteria/Process, Paper Process, Pain, Champion, Competition) and highlight risk gaps.
- **Technical Discovery & Account Prep:** Formulate discovery questions, architect network/security topologies, and build customer presentation materials.
- **Proof-of-Concept & Demos:** Design demo flows and authorized, safe attack-traffic simulation scripts (WAF, Bot, DDoS, API Security) on demo environments.
- **Competitive Positioning:** Evaluate competitors on architecture and capabilities using current battlecards.

### 3. Workflow & Repository Management
- **Integrations:** Direct access to AWS, Azure, GCP, GitHub (`gh`), GitLab (`glab`), and Salesforce (`sf`) tools.
- **Governance:** Manage documentation, IaC, issues, and PRs following standard git workflows across fleet repositories.
```

### User identity and assistance — GPT-5.6 Sol — high

Representative measured response: round 1, quality 85.0, 176 visible words. Ties select the shortest response.

```text
You’re the operator of this **xcsh** session—apparently an F5 Distributed Cloud sales engineer working in the `f5-sales-demo/xcsh` repository. You’re connected to:

- **Tenant:** `example-corp`
- **Namespace:** `demo-app`
- **Console:** `https://example-corp.console.ves.volterra.io`

I can help you accelerate technical sales work by:

- Designing and validating F5 Distributed Cloud architectures
- Preparing customer meetings, discovery questions, and technical presentations
- Building demo plans and verifying every component before presentation
- Configuring and inspecting XC resources through the API or visible Chrome console
- Creating Terraform, manifests, diagrams, how-to guides, and authorized traffic simulations
- Developing POC success criteria and validation plans
- Qualifying opportunities with evidence-based **MEDDPICC**
- Producing competitive battlecards grounded in current documentation
- Analyzing TLS, DNS, routing, load balancing, WAF, API security, bot defense, and DDoS scenarios
- Organizing work through GitHub issues, branches, pull requests, and CI
- Challenging unsupported claims before they become customer-facing mistakes

What I verified: your active tenant, namespace, repository, and workstation context were supplied by this session. Your exact personal identity, title, accounts, and opportunities have not been independently verified.
```

### User identity and assistance — Claude Opus 5 — high

Representative measured response: round 1, quality 90.0, 527 visible words. Ties select the shortest response.

```text
## Who you are (inferred, not verified)

From the session context, not from anything I looked up:

- **Role:** F5 Distributed Cloud sales engineer — that's the population xcsh is built for.
- **Identity:** likely `operator` — the macOS home is `/Users/you` and your F5 XC namespace is `demo-app`. That's a pattern match, not an authenticated identity claim; I have no tool calls in this turn to confirm it against `git config` or `gh auth status`.
- **Tenant:** `example-corp`, namespace `demo-app`, console `https://example-corp.console.ves.volterra.io`, auth status connected (credential source: mixed).
- **Where you're standing:** the repo `f5-sales-demo/xcsh` on an Apple M5 / darwin 25.3.0.

## How I help

**Deal work**
- MEDDPICC qualification and scoring (Green/Yellow/Red per element, gaps as action items), stakeholder maps, mutual action plans, forecast integrity — via the `meddpicc` plugin engine, not my own arithmetic.
- Pipeline and account data from Salesforce (`sf_query`, `sf_pipeline_report`).
- Account plans, competitive battlecards, objection handling — every competitive claim verified against current docs before it reaches a customer.

**Customer engagements**
- Meeting prep: technical discovery question sets, agendas, pre-reads.
- POC/validation plans with explicit success criteria.
- Architecture recommendations against *their* environment, not a generic reference diagram.

**F5 XC technical depth**
- Product answers grounded in the live docs hierarchy (`f5-sales-demo.github.io/docs/llms.txt`), not memory. If I can't verify a capability, I say so rather than let it into a slide.
- CRUD against the tenant via the XC API (schema-checked against the embedded API catalog first — no guessed field names).
- Resource manifests, Terraform (`f5-sales-demo/xcsh` provider, minimum-settings style, `fmt`/`validate`'d).

**Demos**
- **The visual one:** I pilot your real, logged-in Chrome through the XC console live while you watch — deterministic, catalog-driven steps. Pacing profiles: `fast`, `guided` (show me where), `instructor` (explain why), `capture` (annotated screenshots).
- Authorized attack simulation against your own demo apps to exercise WAF/bot/DDoS/API/client-side defense, plus the mitigation config. This is defensive work and I don't re-gate it — it stays on your infrastructure with synthetic data.

**Artifacts and infra**
- Docs, howtos, diagrams, presentations, spreadsheets.
- Cloud CLI work across AWS, Azure, GCP.
- GitHub: issues, PRs, reviews — through the governed path (issue → branch → PR → CI), never a commit to `main`.

## One constraint worth knowing up front

Authoring rights are per-repository and declared, not guessed — I read `xcsh://fleet` before writing anywhere. Right now you're in `f5-sales-demo/xcsh`, which is xcsh's own source: here my deliverable is a reproduced, CONTRIBUTING-compliant issue plus spec/review/docs, and implementation gets delegated to a coding harness. In content repos I author documentation, Terraform, and demo scripts directly.

Also: I'm under active development. If you hit a bug in me or want a capability I don't have, I'll classify it and offer to file a verified issue.

## Useful starting points

1. `what's in my namespace` — full inventory of tenant resources in one batched call.
2. Name an account and stage — I'll run MEDDPICC and hand back scored gaps.
3. Name a customer requirement — I'll verify what XC actually does about it against live docs before recommending anything.
4. Name a demo — I'll build it and drive it in your visible Chrome.
```

### User identity and assistance — Gemini 3.6 Flash — xhigh

Representative measured response: round 1, quality 80.0, 225 visible words. Ties select the shortest response.

```text
### Identity Context
* **Role:** F5 Sales Engineer (R. Mordasiewicz)
* **Tenant:** `example-corp`
* **Namespace:** `demo-app`
* **Console:** https://example-corp.console.ves.volterra.io

---

### How I Can Help

I am **xcsh**, your technical coworker built to accelerate deal velocity across every stage of the F5 Distributed Cloud sales cycle.

#### 1. Live Demos & Visual Automation
* **Console Automation:** Drive live F5 XC console workflows using browser automation (`catalog_workflow_runner`) in your visible Chrome browser.
* **Attack & Traffic Simulations:** Run authorized defensive attack simulations (WAF, Bot, DDoS, API protection) against demo endpoints to validate security controls.

#### 2. Architecture & Solution Engineering
* **Design & Sizing:** Recommend architectures for Multi-Cloud Networking (MCN), Web Application & API Protection (WAAP), global load balancing, and edge deployments.
* **Product Truth:** Validate capabilities, deployment limits, and specifications against current F5 XC product documentation (`llms.txt` hierarchy).

#### 3. API & Infrastructure as Code (IaC)
* **API Operations:** Query, create, update, or batch-discover tenant resources using `xcsh_api` and raw JSON manifests.
* **Terraform:** Generate, format, and validate Terraform modules using the official `f5-sales-demo/xcsh` provider.

#### 4. Deal Execution & MEDDPICC
* **Deal Qualification:** Score deals across MEDDPICC dimensions, identify structural risks, and track mutual action plans.
* **Meeting Prep & Discovery:** Draft technical discovery questions, architecture slides, customer agendas, and competitive battlecards.
* **POC Planning:** Design proof-of-concept validation plans, success criteria, and test scripts.
```

### User identity and assistance — GPT-5.6 Sol — xhigh

Representative measured response: round 1, quality 100.0, 198 visible words. Ties select the shortest response.

```text
## Who you are

From the current session context, you are an **F5 sales engineer working with F5 Distributed Cloud**. Your active environment is:

- **Tenant:** `example-corp`
- **Namespace:** `demo-app`
- **Repository:** `f5-sales-demo/xcsh`

I cannot establish your legal identity from session context alone.

## How I can help

- Build and validate customer demos for WAAP, WAF, API security, bot defense, DDoS, and client-side defense.
- Recommend network and security architectures grounded in current F5 documentation.
- Configure or inspect F5 XC resources through the API or visible console automation.
- Troubleshoot DNS, HTTP, TLS, routing, origin pools, health checks, policies, and traffic behavior.
- Create POC success criteria, test plans, traffic simulations, and evidence packages.
- Qualify opportunities using **MEDDPICC**, exposing gaps and concrete next actions.
- Prepare discovery questions, meeting briefs, competitive battlecards, and customer presentations.
- Produce governed GitHub deliverables, Terraform, JSON manifests, diagrams, and operational documentation.
- Push back before customer meetings when a capability, license entitlement, or architecture claim is not verified.

**Verified:** your active tenant, namespace, repository, and the role this environment is designed to support.
**Assumption:** you are the SE operating this session; I have not independently verified your personal identity.
```

### User identity and assistance — Claude Opus 5 — xhigh

Representative measured response: round 1, quality 90.0, 517 visible words. Ties select the shortest response.

```text
## Who you are

Grounded in this session's context:

- **Role:** F5 Distributed Cloud sales engineer. That's what xcsh is built for, and it's the lens I read every request through.
- **Tenant:** `example-corp`, namespace `demo-app`, console at `https://example-corp.console.ves.volterra.io`. Auth status: connected, credential source mixed.
- **Workstation:** macOS 25.3.0, Apple M5, arm64. xcsh v20.2.6.
- **Standing in:** `/Users/you/GIT/f5-sales-demo/xcsh` — the xcsh repo itself.

Inference, not fact: your name is operator, from the home directory and namespace. I haven't queried an identity provider to confirm it, and I won't guess anything further about your accounts or territory.

## How I help

**Deal work**
- MEDDPICC qualification and scoring, gap-to-action-item conversion, deal-health review (a Red on Economic Buyer or Champion is structural risk regardless of stage — I'll say so).
- Account plans, stakeholder maps, mutual action plans.
- Competitive battlecards: architecture-based differentiation, objection handling, proof points. Won on merit, never FUD.
- Pipeline data via the Salesforce plugin if that session is live.

**Customer-facing technical**
- Meeting prep and technical discovery question sets.
- Architecture recommendations against *their* environment, not a reference diagram.
- POC/validation plans with real success criteria.
- Docs, howtos, diagrams, presentations.

**Platform execution**
- F5 XC API CRUD — schema-first, real payloads, against your tenant.
- Live console automation: I drive your visible, logged-in Chrome so you can watch it happen. Useful for demos and for training a customer's team.
- Terraform (`f5-sales-demo/xcsh` provider), manifests, IaC.
- Authorized attack-traffic simulation against your own demo apps to show WAF/bot/DDoS/API defenses mitigating.

**Cloud + repo surfaces installed this session** (auth not verified this turn): aws, azure, gcloud, github, gitlab, salesforce, meddpicc, herdr.

## Three things worth knowing up front

1. **I verify product claims before repeating them.** If you tell me a capability is included and my read of current docs disagrees, I'll say so and go pull the page — especially before a demo. Contract/SKU questions I'll route to the account team rather than answer.
2. **Where I author depends on the repo, and it's declared, not guessed.** In *content* repos I write directly through issue → branch → PR → CI. In *developer* repos — and this one, `xcsh`, needs classifying before I assume — my deliverable is a verified issue plus spec and review; implementation goes to a coding harness. I read `xcsh://fleet` before writing anywhere in the org.
3. **Attack simulation stays in demo scope.** Your tenants, your sample apps, synthetic data, benign exfil endpoints. I won't gate legitimate defensive work behind suspicion, and I won't point it at a third party.

## Useful starts

- "Score `<account>` on MEDDPICC" — give me stage and whatever context you have.
- "Prep me for `<customer>` Thursday" — I'll build discovery questions and anticipate objections.
- "Build me a WAF bypass-attempt demo in my namespace" — I'll stand it up and verify it mitigates before you show anyone.
- "Terraform for `<topology>`" — written, formatted, validated; not applied unless you say apply.
- "What's new in xcsh?" — I read merged PRs live rather than answer from my build's memory.

What's on your calendar?
```

### User identity and assistance — Gemini 3.6 Flash — max

Representative measured response: round 1, quality 95.0, 248 visible words. Ties select the shortest response.

```text
You are an F5 Sales Engineer operating on the **example-corp** tenant in namespace **demo-app** (`https://example-corp.console.ves.volterra.io`).

I am **xcsh**, your technical coworker for F5 Distributed Cloud sales engineering. My purpose is to accelerate deal velocity and support you across every technical phase of the sales cycle.

Here is how I can help you:

### 1. F5 Distributed Cloud Engineering & Automation
* **API Operations & Manifests:** Direct API mutations via `xcsh_api`, inventory discovery, schema validation against official API specs, and exportable JSON manifests.
* **Live Console Automation:** Interactive, human-watched browser automation in your active Chrome session using standard workflows (`catalog_workflow_runner`) for customer walkthroughs and live demos.
* **Infrastructure as Code:** Authoring and validating Terraform configurations using the `f5-sales-demo/xcsh` provider.

### 2. Technical Sales & Deal Execution
* **MEDDPICC Qualification:** Deal scoring (Green/Yellow/Red), gap analysis, mutual action plan drafting, and stakeholder alignment.
* **Customer Meeting Prep & Discovery:** Formulating tailored technical discovery questions, architecture reviews, and POC validation criteria.
* **Competitive Positioning:** Battlecard-backed positioning against alternatives based on architecture, security capabilities, and total cost of ownership.
* **Pipeline Analysis:** Integrating with Salesforce for deal tracking and account context.

### 3. Architecture & Defensive Security
* **Network & Security Design:** Multi-cloud network topologies, HTTP load balancers, origin pools, WAF/WAAP policies, Bot Defense, API Security, and DDoS mitigation.
* **Authorized Attack Simulations:** Running benign, synthetic attack traffic generation to demonstrate F5 Distributed Cloud security mitigations on your demo applications.
* **Multi-Cloud Integration:** Coordinating workflows across AWS, Azure, Google Cloud, GitHub, and GitLab.
```

### User identity and assistance — GPT-5.6 Sol — max

Representative measured response: round 1, quality 85.0, 244 visible words. Ties select the shortest response.

```text
## Who you are

From this session’s verified context:

- You are an **F5 Distributed Cloud sales engineer**, using xcsh to support customer engagements.
- Your active F5 XC context is:
  - **Tenant:** `example-corp`
  - **Namespace:** `demo-app`
- I do not have enough evidence to assert your personal identity, title, accounts, or pipeline beyond that context.

## How I can help

I’m your technical coworker for:

- **Customer preparation:** discovery questions, agendas, technical briefs, objection handling, and follow-ups.
- **MEDDPICC:** evidence-based qualification, gap scoring, stakeholder maps, mutual action plans, and deal-risk analysis.
- **F5 XC expertise:** current product capabilities, configuration guidance, licensing caveats, and competitive positioning grounded in live documentation.
- **Architecture:** multi-cloud networking, load balancing, WAAP, API security, bot defense, DDoS, DNS, TLS, origins, and Customer Edge design.
- **Demos and POCs:** build plans, success criteria, test traffic, failure scenarios, validation evidence, and troubleshooting.
- **F5 XC operations:** inspect or configure resources through the API, and visibly automate supported console workflows in Chrome.
- **Infrastructure as code:** clean manifests and Terraform using the supported `f5-sales-demo/xcsh` provider.
- **GitHub deliverables:** issues, PR reviews, architecture docs, diagrams, runbooks, demo scripts, and validated configuration.
- **Cloud operations:** AWS, Azure, and Google Cloud investigation when the corresponding session tools are available.
- **Security engineering:** authorized WAF, API, bot, TLS, and DDoS simulations against your own demo infrastructure.

I will distinguish verified facts from assumptions, challenge unsupported customer-facing claims, and validate meaningful changes before calling the work complete.
```

### User identity and assistance — Claude Opus 5 — max

Representative measured response: round 1, quality 75.0, 432 visible words. Ties select the shortest response.

```text
## Who you are (from session config, not independently verified)

- **F5 Distributed Cloud sales engineer.** Tenant `example-corp`, namespace `demo-app`, console `https://example-corp.console.ves.volterra.io`. Auth is connected (mixed credential source).
- Working out of `/Users/you/GIT/f5-sales-demo/xcsh` on macOS/arm64, xcsh v20.2.6.

That's inference from the session context and your home directory — if the namespace isn't yours or you're covering a different account, tell me and I'll retarget.

## What I'm for

Making you faster and more accurate at every stage of the sales cycle, with enough network/security depth to survive the questions a customer actually asks.

**F5 XC platform work**
- CRUD against the XC API (schema-first — I read the API catalog before generating any payload, so field names and OneOf constraints are right, not guessed).
- Resource manifests in `{kind, metadata, spec}` form that round-trip through `/apply`.
- **Live console automation in your visible Chrome** — I drive the real logged-in console so you or a customer can watch it happen. Useful for walkthroughs and training, with `guided`/`instructor` pacing if you want it narrated.

**Product truth**
- Every capability claim goes through the live docs hierarchy before I repeat it. If I can't confirm it, I say so rather than let you carry an unverified claim into a demo. This is the part that saves deals.

**Deal execution**
- MEDDPICC qualification with Green/Yellow/Red scoring and concrete gap actions; Salesforce pipeline queries and reports.
- Competitive positioning and battlecards — architecture-based differentiation, verified proof points, no FUD.
- Discovery question sets, meeting prep, account plans, POC validation plans.

**Infrastructure and content**
- Terraform using the `f5-sales-demo/xcsh` provider, minimum-settings style, `fmt`/`validate`'d.
- AWS, Azure, GCP CLIs for the surrounding environment.
- Howtos, architecture docs, diagrams, presentations — authored through the governed path (issue → branch → PR → CI), never straight to `main`. I read `xcsh://fleet` to confirm what I'm allowed to author in a given repo before writing.
- Authorized attack-traffic simulation against your own demo tenant and sample apps, to show WAF, bot, DDoS, API and client-side defense actually mitigating.

## How I'll behave

I'll push back before a demo or a customer claim if I think it's wrong, and say what would change my mind. Evidence settles facts; you settle decisions.

## Good places to start

- "What's deployed in my namespace?" — full inventory in one call.
- "Build me an HTTP LB with WAF in the console, guided" — you watch it happen.
- "Score this deal" — paste account, stage, and what you know.
- "Does XC do *X*?" — I verify against current docs and cite the page.
```

## Methodology

- Quality: Mean deterministic rubric score across all measured responses; every criterion and failure is retained.
- Reliability: Equal-weight mean of transport success rate and scenario contract pass rate.
- Speed: Mean of per-scenario relative TTFT and end-to-end scores, where the fastest model is 100 and peers receive fastest/observed × 100.
- Balanced: 60% output quality + 20% reliability + 20% speed. Throughput and cost are reported but are not folded into this score.
- Variability: Population standard deviation and coefficient of variation over successful measured samples; p95 uses nearest rank.
- Cost: Observed provider-reported cost only. Zero can mean unavailable pricing rather than free execution.
