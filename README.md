# WTipnology Picks

The affiliate picks page. One static `index.html`, one `products.csv` that is the
single source of truth, one script to add products, and tests that hold the line.

## How it works

- `index.html` reads `products.csv` at load time and renders the cards. Arabic first,
  RTL, with an English toggle. No build step, no database, no Google Sheet.
- `products.csv` is the source of truth. Columns:
  `show | category_ar | category_en | name_ar | name_en | verdict_ar | verdict_en | url | image`
  Set `show` to `no` to hide a row without deleting it.
- Push to `main` and the site republishes itself (GitHub Pages). No more manual upload.

## Add a product

```
npm run add <your noon affiliate link>
```

It reads the name and one spec from the link and page, drafts an Arabic + English
row, prints it, and asks before appending to `products.csv`. It **refuses a plain
noon product link** and tells you to paste your affiliate link instead.

The verdict it drafts is a stub built from a single real number, or blank when the
page has no such number. Rewrite it. The verdict is the product: one line a spec
sheet could not produce.

After it appends, edit the verdict in `products.csv`, then:

```
git add products.csv && git commit -m "add <product>" && git push
```

## Tests (the guardrails)

```
npm test
```

Four rules, enforced on every push before the site can deploy:

1. No prices anywhere in the output.
2. Every product URL is an affiliate link, not a bare noon link.
3. No em dashes or hyphens in copy (hyphens allowed only inside product model names).
4. Arabic strings never get CSS letter-spacing (it breaks the joins).

## What still needs a real value

- The **affiliate rule** in `scripts/affiliate.mjs` currently treats "carries a
  tracking parameter" as affiliate. Paste one real noon affiliate link and we narrow
  it to that exact shape.
- The three rows in `products.csv` are **examples with placeholder links**. Replace
  or delete them.

## Deploy + domain

Pages serves from this repo. The custom domain lives in the `CNAME` file
(`picks.wtipnology.com`). At GoDaddy, add one DNS record:

| Type  | Name (Host) | Value               | TTL     |
|-------|-------------|---------------------|---------|
| CNAME | `picks`     | `wtipnology-star.github.io` | 1 hour  |
