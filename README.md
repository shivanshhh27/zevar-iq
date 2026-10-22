# DesignLedger

A hackathon MVP for independent Indian jewellers. Jewellers record stock by weight, not by design, so they can't see what sells and gold stays locked in designs that don't. DesignLedger fixes that in one screen:

1. Add stock photos (with weight, quantity and stock-in date) and a sales CSV.
2. Press **Analyze**.
3. See, in under a second, how many designs have not sold in 12 months and how many grams of gold they hold.
4. Get a **reorder** list and a **do-not-reorder** list, each item with a reason, and Approve / Edit buttons. Nothing is ever sent to a karigar.

Live demo: https://designledger-neon.vercel.app

Try it without any files: click **Try with sample data (20 photos)**, then **Analyze**.

## How it works

| Step | Who does it |
| --- | --- |
| Read and check the sales CSV | plain code (`lib/csv.ts`) |
| Match sales to designs, find stuck stock, rank designs | plain code (`lib/analysis.ts`) |
| Tag each photo (category, style, price band, how sure) | AI: Gemini reads the photo (`app/api/tag/route.ts`) |
| Explain each reorder / do-not-reorder pick | AI: Gemini writes one reason per design (`app/api/reorder/route.ts`) |
| Review tags, approve or edit the lists | you |

The stuck-gold banner needs only weights, dates and sales, so it appears instantly. Photo tagging runs in the background, five photos per Gemini request.

## What the screen shows when something is wrong

- Empty, missing or broken input gives a plain message that names the problem (for example the missing CSV column or the row with a bad date).
- A photo that is not jewellery is left out and flagged. A photo the AI is unsure about is highlighted amber for you to check.
- If the AI is busy or the free daily limit is used up, the banner and board still work, and the screen says what happened. You can tag by hand.

## Run it on your computer

You need Node.js and a Gemini API key from [aistudio.google.com](https://aistudio.google.com).

```bash
npm install
cp .env.example .env.local   # then paste your key after GEMINI_API_KEY=
npm run dev
```

Open http://localhost:3000. The key lives only in `.env.local`, which git ignores. Never put it in code or commit it.

Run the checks of the maths (no AI, no key needed) with `npm test`.

## Deploy to Vercel

1. Push this repo to GitHub and import it at [vercel.com/new](https://vercel.com/new).
2. Before deploying, add the environment variable `GEMINI_API_KEY` with your key.
3. Deploy. Pushing to GitHub redeploys automatically.

## Limits to know about

- The free Gemini plan allows only a small number of requests per day per model. Batching keeps a 20-photo run to 4 requests plus 1 for the reasons.
- Sales are linked to designs by `design_id`, which must match the Design ID shown on each photo. Linking real sales to designs automatically (scan at sale) is a later step.
- This MVP keeps everything in the browser: there is no database and no login.

## Project map

- `app/page.tsx`: the one screen
- `components/Results.tsx`: banner, lists and board
- `app/api/tag/route.ts`, `app/api/reorder/route.ts`: the two Gemini calls (server side, so the key stays secret)
- `lib/prompts.ts`: what the AI is asked
- `lib/designTags.ts`: the fixed tag lists the AI must choose from
- `lib/csv.ts`, `lib/analysis.ts`: the plain-code maths
- `public/sample/`: 20 sample photos (credits in `public/sample/photos/CREDITS.md`), stock details and a sales file
