This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## OnlyMonster webhooks

Configure the webhook signing secret on the server:

```bash
ONLYMONSTER_WEBHOOK_SECRET=your_webhook_secret
```

Use this public URL in OnlyMonster:

```text
https://TU-DOMINIO.vercel.app/api/webhooks/onlymonster
```

The app validates:

- `x-om-webhook-signature`
- `x-om-webhook-timestamp`
- `x-om-webhook-id`

Signature format:

```text
signedContent = `${timestamp}.${rawBody}`
expected = HMAC-SHA256(signedContent, ONLYMONSTER_WEBHOOK_SECRET)
```

Recent webhook events can be inspected at `/webhooks-debug`. The webhook handler
does not call OpenAI and does not store API keys or secrets in the frontend.

## Fan intelligence persistence

The deep fan profile and analysis cache are persisted through Vercel KV / Upstash
Redis. Configure these server-side variables in production:

```bash
KV_REST_API_URL=your_kv_rest_url
KV_REST_API_TOKEN=your_kv_rest_token
```

`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are also supported. In
local development only, the app falls back to in-memory cache.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
