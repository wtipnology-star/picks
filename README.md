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
npm run add <your affiliate link>
```

Works with any supported store (currently **noon** and **Amazon**). It reads the name
and one spec from the link and page, drafts an Arabic + English row, prints it, and
asks before appending to `products.csv`. It **refuses a link that is not from a
supported store, or a bare/untracked link** that would earn you nothing (e.g. an
`a.co` Amazon share link, or a plain noon product URL).

To support another affiliate program later, add one block to `MERCHANTS` in
`scripts/affiliate.mjs` (id, `match`, `isAffiliate`, `hint`). Nothing else changes.

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
2. Every product URL is an affiliate link from a supported store, not a bare one.
3. No em dashes or hyphens in copy (hyphens allowed only inside product model names).
4. Arabic strings never get CSS letter-spacing (it breaks the joins).

## What still needs a real value

- The **affiliate rules** in `scripts/affiliate.mjs` are best-guess until real
  accounts exist (noon: "carries a tracking parameter"; Amazon: `amzn.to` or `?tag=`).
  Paste one real tracked link per store and we narrow each to its exact shape.
- The three rows in `products.csv` are **examples with placeholder links**. Replace
  or delete them.

## Deploy + domain

Pages serves from this repo (Actions build). The custom domain is set in the repo's
Pages settings and served over HTTPS. DNS for `wtipnology.com` is managed in **AWS
Route 53** (not GoDaddy — the nameservers point to AWS), where this record lives:

| Type  | Name    | Value                       | TTL |
|-------|---------|-----------------------------|-----|
| CNAME | `picks` | `wtipnology-star.github.io` | 300 |
