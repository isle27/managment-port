# Portfolio projects

Portfolio Studio is the editor for AI Engineering and Software Engineering projects. It saves to `public.portfolio_projects` in the shared Neon database. The two public sites read the published-only `public.portfolio_published_projects` view, filter by portfolio, and use the dashboard's display order.

## Run locally

From the repository root on Windows, run `npm.cmd run dev` with Node.js 24, then open http://127.0.0.1:3010. Keep the terminal running while you use the dashboard. The server reads `DATABASE_URL` from the environment, the dashboard's `.env`, or the neighboring `SE-Portfolio/.env` if present. Set `PORTFOLIO_ENV_FILE` to use a specific environment file. Without a database connection the workspace shows a connection error.

## Use the shared Neon database

1. Review and run [schema.sql](schema.sql) on the Neon branch and database that both portfolios will use. The migration adds AI publishing fields, preserves existing SE projects, and copies existing compatible AI projects from `public.projects` once, preserving their publication state and page URLs. It leaves the original AI table in place. If your original AI projects are on a different branch or database, import them into the selected shared database before switching the AI site.
2. Set the private dashboard's server-side `DATABASE_URL` runtime secret. Its role needs table read/write, identity sequence, and reorder function access. Set the same database and branch in the AI and SE hosting environments. Their reader roles only need schema access and SELECT on the published view.
3. Deploy the AI and SE source updates from their repositories. SE on Vercel uses `api/projects.mjs`. AI reads the published view through its Next.js server.
4. In the dashboard, add a project, upload its cover, and choose its portfolios. Save as a draft or check Publish to portfolios. Use Reorder to change the shared order. Uploads are resized in the browser and stored in the project's existing Neon image field. Existing URL-based covers continue to work.

Run `npm run build` to produce the Sites Worker in `dist`. The dashboard's hosted admin API uses the private Site's identity boundary.

## Deploy the dashboard on Vercel

Import the `managment-port` GitHub repository and leave Root Directory at the repository root. Use the Other framework preset and let `vercel.json` supply the build command and output directory. Keep any previous build and output overrides disabled.

Set `DATABASE_URL` and a strong, unique `ADMIN_PASSWORD` as server-side Production variables, then deploy the updated commit. Open the deployment over HTTPS and sign in with username `admin` and the password you set. The Vercel function protects the dashboard and all management API routes with an eight-hour session. Use **Sign out** when finished. The portfolios still read their own published-only view from Neon.
