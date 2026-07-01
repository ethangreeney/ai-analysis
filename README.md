# ai-analysis

A chart for comparing frontier AI models on the three things that actually matter: intelligence, end-to-end response time, and cost per task.

![screenshot](docs/screenshot.png)

## Why

The existing AI comparison charts are all a bit off. They use token price as a stand-in for cost, which hides how much reasoning models really burn through on a task. Or they treat speed as tokens-per-second, which doesn't capture the wait you actually feel. So this one uses the numbers Artificial Analysis publishes: cost per Intelligence Index task and median end-to-end response time per query.

- **Intelligence** is the Y axis (AA Intelligence Index).
- **End-to-end response time** is the X axis. Log scale — wait-time is felt logarithmically.
- **Cost per task** is the colour. Log scale — budgets are felt multiplicatively.

## Run it

```sh
npm install
cp .env.example .env   # paste your Artificial Analysis API key
npm run fetch          # pull latest model numbers and refresh docs/screenshot.png
npm run dev            # opens the chart in your browser
```

`npm run fetch` discovers the model list from the live Artificial Analysis API and model metrics payload, then regenerates the local data file and README screenshot. Rows without the selected Y-axis metric are not plotted for that view. Priced rows without end-to-end response time sit on the timing n/a rail; rows without cost per task use a neutral color when surfaced by search.
