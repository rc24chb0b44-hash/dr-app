# RetinaScan — Developer Guide

This doc explains **everything** about how this project is built: the architecture, every
folder's purpose, every core concept (Next.js, React, MongoDB, auth, Tailwind), and how to make
common changes. Read it once and you should be able to rebuild this project from scratch, or
extend it confidently.

---

## 1. The big picture

This is a **Next.js 14 App Router** project. The single most important thing to understand:

> **One project, two jobs.** The same codebase serves the pages you see in the browser (the
> "frontend") *and* the JSON API endpoints that talk to MongoDB (the "backend"). There is no
> separate Express server, no separate repo for the API. A file's *location* in the `app/` folder
> decides whether it's a page or an API route.

This is why it deploys to Vercel so easily — Vercel understands this convention natively.

```
Browser  ──requests──▶  Next.js server (Vercel)  ──queries──▶  MongoDB Atlas
                              │
                    ┌─────────┴─────────┐
                    │                   │
              app/**/page.jsx     app/api/**/route.js
              (renders HTML)      (returns JSON)
```

---

## 2. Folder-by-folder map

```
dr-app/
├── app/                    ← Every route in the app lives here (App Router convention)
│   ├── layout.jsx          ← Wraps every page: <html>, <body>, Navbar, Footer
│   ├── page.jsx            ← The "/" route (homepage)
│   ├── globals.css         ← Tailwind imports + custom reusable CSS classes
│   ├── login/page.jsx      ← The "/login" route
│   ├── signup/page.jsx     ← The "/signup" route
│   ├── dashboard/page.jsx  ← The "/dashboard" route
│   ├── submit/page.jsx     ← The "/submit" route
│   ├── profile/
│   │   ├── page.jsx        ← The "/profile" route
│   │   └── [id]/page.jsx   ← The "/profile/xyz123" route (dynamic segment)
│   └── api/                ← Every API endpoint lives here
│       ├── auth/
│       │   ├── signup/route.js
│       │   ├── login/route.js
│       │   ├── logout/route.js
│       │   └── me/route.js
│       └── submissions/
│           ├── route.js        ← GET/POST for "/api/submissions"
│           └── [id]/route.js   ← GET/PATCH/DELETE for "/api/submissions/xyz123"
│
├── components/             ← Reusable UI pieces, used by multiple pages
│   ├── Navbar.jsx
│   ├── Footer.jsx
│   ├── GradientBackdrop.jsx
│   ├── SubmissionWizard.jsx
│   ├── StepIndicator.jsx
│   ├── ImageDropzone.jsx
│   └── DiscardDraftButton.jsx
│
├── models/                 ← MongoDB schema definitions (Mongoose)
│   ├── User.js
│   └── Submission.js
│
├── lib/                    ← Plain helper functions, no UI
│   ├── mongodb.js           ← Opens/reuses the DB connection
│   ├── auth.js              ← Sign & verify JWT tokens
│   ├── session.js           ← "Who is logged in right now?" helper
│   └── resizeImage.js       ← Browser-side image compression
│
├── middleware.js           ← Runs before matching requests; guards protected routes
├── tailwind.config.js      ← Design tokens: colors, animations, fonts
├── postcss.config.js       ← Wires Tailwind into the CSS build
├── jsconfig.json           ← Enables the "@/" import shortcut
├── next.config.js          ← Next.js settings (body size limit, etc.)
└── package.json            ← Dependencies + npm scripts
```

**Rule of thumb for where new code goes:**
- Renders something the user sees at a URL → `app/.../page.jsx`
- Returns JSON, talks to the DB, no visual output → `app/api/.../route.js`
- A chunk of UI reused in 2+ places → `components/`
- A DB schema → `models/`
- Logic with no UI, reused in several places → `lib/`

---

## 3. Core Next.js App Router concepts

### 3.1 File-based routing
The folder path under `app/` **is** the URL path. `app/dashboard/page.jsx` → `yoursite.com/dashboard`.
A folder name in square brackets is a **dynamic segment**: `app/profile/[id]/page.jsx` matches
`/profile/anything`, and inside that file, `params.id` gives you the actual value ("anything").

### 3.2 Server components vs. Client components
This is the single most important React concept in this project.

| | Server Component (default) | Client Component (`'use client'` at top) |
|---|---|---|
| Where it runs | Only on the server, never sent to the browser as JS | Runs in the browser |
| Can use hooks (`useState`, `useEffect`)? | ❌ No | ✅ Yes |
| Can directly call `await dbConnect()`? | ✅ Yes | ❌ No (must call an API route via `fetch`) |
| Can handle onClick, onChange? | ❌ No | ✅ Yes |
| Example in this project | `app/dashboard/page.jsx` | `components/SubmissionWizard.jsx` |

**Why it matters:** `app/dashboard/page.jsx` has no `'use client'` at the top — it's a server
component. That's why it can do this directly, with no API call needed:
```jsx
export default async function DashboardPage() {
  const user = await getCurrentUser();      // reads a cookie, on the server
  await dbConnect();                        // opens a DB connection, on the server
  const draft = await Submission.findOne({ userId: user.userId, status: 'draft' });
  // ...then render HTML using `draft`
}
```
No `fetch`, no loading spinner needed — the page arrives from the server already containing the
data. Compare this to `components/Navbar.jsx`, which **is** `'use client'` because it needs
`useState`/`useEffect` to check login status after the page has already loaded, and needs
`onClick` handlers for the logout button.

**Rule of thumb:** if a component needs interactivity (clicks, typing, hooks) → client component.
If it just needs to fetch/display data once when the page loads → server component (faster,
simpler, and it's the default so you don't even need to write anything special).

### 3.3 Layouts
`app/layout.jsx` is special — it wraps *every* page in the app. It's where `<html>`, `<body>`,
the `<Navbar />`, and `<Footer />` live, so you don't repeat them on every page. `{children}` is
where the actual page content (e.g. `app/page.jsx` or `app/login/page.jsx`) gets inserted.

### 3.4 Route Handlers (the API)
Any file named exactly `route.js` inside `app/api/...` defines an API endpoint. You export a
function named after the HTTP method:
```js
export async function GET(request) { ... }
export async function POST(request) { ... }
export async function PATCH(request, { params }) { ... }
export async function DELETE(request, { params }) { ... }
```
`params` (for dynamic routes like `[id]`) gives you the URL segment. You always return a
`NextResponse.json({...}, { status: 200 })`.

### 3.5 Middleware
`middleware.js` at the project root runs **before** the matched request even reaches a page. In
this project it checks: "does this request have a valid login cookie?" and redirects to `/login`
if not, for any path matching `/dashboard`, `/submit`, or `/profile`. The `config.matcher` array
at the bottom of that file controls which paths trigger it.

---

## 4. Authentication, explained end to end

There's no third-party auth service here — it's built from three simple pieces:

**Step 1 — Signing up** (`app/api/auth/signup/route.js`):
1. Take `{ name, email, password }` from the request body.
2. Hash the password with `bcrypt` (`bcrypt.hash(password, 10)`) — **never** store plain-text
   passwords. The `10` is the "salt rounds," a cost factor that makes brute-forcing slower.
3. Save the user to MongoDB with the hash (not the plain password).
4. Create a **JWT** (JSON Web Token) — a signed string that encodes `{ userId, email, name }`.
   "Signed" means it's tamper-proof: if anyone edits the payload, the signature won't match
   anymore, and our server will reject it.
5. Set that JWT as an **httpOnly cookie** named `token`. `httpOnly` means client-side JavaScript
   can't read it (protects against XSS token theft) — only the browser automatically attaches it
   to every request to our own domain.

**Step 2 — Every subsequent request**: the browser automatically sends the `token` cookie. Our
server reads it (`lib/session.js`'s `getCurrentUser()`), verifies the signature with `lib/auth.js`'s
`verifyToken()`, and if valid, we know exactly who's asking — no database lookup needed for basic
identity, since the user info is embedded right in the token.

**Step 3 — Logging in**: `app/api/auth/login/route.js` does the same but compares
`bcrypt.compare(password, user.passwordHash)` instead of creating a new user.

**Step 4 — Protecting pages**: `middleware.js` checks for a valid token before letting the request
reach `/dashboard`, `/submit`, `/profile`.

**Why `jose` instead of the more common `jsonwebtoken` package?** `jsonwebtoken` relies on Node's
built-in crypto module, which isn't available in Next.js's "Edge Runtime" (used by middleware).
`jose` is written to work in both environments, so we can use the exact same sign/verify functions
in `middleware.js`, in API routes, and in server components.

---

## 5. MongoDB & Mongoose, explained

**MongoDB** is a NoSQL database — instead of tables/rows like SQL, it stores JSON-like documents
in "collections." **Mongoose** is a library that lets us define a schema (shape) for those
documents in JavaScript, and gives us convenient methods (`.find()`, `.create()`, `.save()`) to
query them.

### 5.1 Schemas (`models/`)
```js
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true });
```
`timestamps: true` auto-adds `createdAt`/`updatedAt` fields. `mongoose.models.User || mongoose.model('User', UserSchema)`
is a guard against Next.js's hot-reload redefining the model twice in development (which would
throw an error).

### 5.2 Connecting (`lib/mongodb.js`)
Serverless functions (what Vercel runs) can spin up fresh on every request. Opening a *new*
database connection every single time would be slow and could exhaust MongoDB's connection limit.
The fix is a **cached connection pattern**:
```js
let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

async function dbConnect() {
  if (cached.conn) return cached.conn;          // reuse if already connected
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
```
`global` persists across function invocations within the same warm serverless instance, so
subsequent calls skip re-connecting.

### 5.3 The two collections in this app
- **`User`**: `name`, `email`, `passwordHash`.
- **`Submission`**: one document per "response." Has a `status` (`'draft'` or `'completed'`), a
  `currentStep` (1–4, tracks wizard progress), a nested `personalData` object, and two base64
  image strings (`leftEyeImage`, `rightEyeImage`).

**Design decision worth knowing:** images are stored as base64 text *inside* the MongoDB
document, not as files in cloud storage. This keeps the stack simple (no S3/Cloudinary account
needed) at the cost of larger documents. Fine for a research MVP; if you outgrow it, swap those
two fields for URLs pointing at uploaded files elsewhere — nothing else in the app needs to change.

---

## 6. The multi-step "Google Forms" pattern

This is the trickiest part of the app, so let's trace it fully.

**The rule:** a user can only have one submission with `status: 'draft'` at a time. Every "Next"
click immediately saves that step's data to MongoDB — so refreshing, closing the tab, or coming
back tomorrow resumes exactly where you left off.

**How it's wired:**

1. `app/submit/page.jsx` is a **server component**. On every visit, it runs:
   ```js
   let draft = await Submission.findOne({ userId: user.userId, status: 'draft' });
   if (!draft) draft = await Submission.create({ userId: user.userId, status: 'draft', currentStep: 1 });
   ```
   This either finds your in-progress draft or creates a brand new one. Either way, by the time
   the page renders, a draft definitely exists.

2. That draft is passed as a prop into `<SubmissionWizard initialData={draft} />` — a **client
   component**, because the wizard needs state and click handlers.

3. Inside `SubmissionWizard.jsx`, all the form data lives in React state:
   ```js
   const [step, setStep] = useState(initialData.currentStep || 1);
   const [personalData, setPersonalData] = useState({ ...initialData.personalData });
   const [leftEyeImage, setLeftEyeImage] = useState(initialData.leftEyeImage || '');
   ```

4. Clicking "Save & Continue" calls `handleNext()`, which:
   - Validates the current step's fields.
   - Sends a `PATCH` request to `/api/submissions/:id` with **only that step's data** plus the
     next `currentStep` number.
   - On success, updates local state to move to the next step.

5. The API route (`app/api/submissions/[id]/route.js`, `PATCH` handler) merges whatever fields
   were sent into the existing document and saves it. It refuses to touch anything if
   `status === 'completed'` (locking finished responses).

6. On the final step, "Submit response" sends `{ ...allData, complete: true }`. The API checks
   that all required fields exist, then sets `status: 'completed'` and `completedAt: new Date()`.

**Why this design?** Because progress is persisted to the database on every step (not just at the
very end), a user can close their laptop mid-form and pick up later without losing anything —
exactly like Google Forms' autosave.

---

## 7. Image handling — `lib/resizeImage.js` and `components/ImageDropzone.jsx`

Uploading a raw phone photo (often 3-5MB) as base64 JSON would bloat requests and risk hitting
Vercel's serverless body size limit. So before anything gets sent to the server, the browser:

1. Reads the file as a data URL (`FileReader.readAsDataURL`).
2. Draws it onto an off-screen `<canvas>` element, scaled down to a max width of 900px.
3. Re-exports the canvas as a JPEG at ~72% quality (`canvas.toDataURL('image/jpeg', 0.72)`).

This all happens client-side, with zero extra dependencies — canvas is a built-in browser API.
The result is a much smaller base64 string that gets sent in the `PATCH` request body.

`ImageDropzone.jsx` is the UI wrapper: handles drag-and-drop events, click-to-browse via a hidden
`<input type="file">`, shows a preview once an image is set, and surfaces errors (e.g. non-image
files).

---

## 8. Tailwind CSS concepts used here

Tailwind is a **utility-first** CSS framework — instead of writing custom CSS classes, you compose
small pre-made classes directly in your JSX: `className="flex items-center gap-4 rounded-2xl p-6"`.

### 8.1 Custom design tokens (`tailwind.config.js`)
The `theme.extend` block adds project-specific values on top of Tailwind's defaults:
- `colors.ink` — the near-black background color used everywhere (`bg-ink`).
- `animation` / `keyframes` — defines `animate-blob`, `animate-float`, `animate-fade-up`, which
  are then used as plain classes (e.g. `className="animate-blob"`) anywhere in the app.
- `fontFamily.display` / `fontFamily.body` — the two font stacks (`font-display`, `font-body`).

### 8.2 Reusable component classes (`app/globals.css`)
Some class combinations repeat so often (buttons, inputs, glass cards) that we define shortcuts
using Tailwind's `@layer components` directive:
```css
@layer components {
  .btn-primary {
    @apply inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 font-semibold text-white
      bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500;
  }
}
```
`@apply` lets you bundle multiple Tailwind utilities into one custom class name. Now any button
just needs `className="btn-primary"` instead of repeating that whole utility list. Same idea for
`.glass-card`, `.input-field`, `.label-text`, `.gradient-text`.

### 8.3 Arbitrary values & modifiers
You'll see things like `bg-white/[0.04]` (4% opacity white), `[animation-delay:4s]` (a raw CSS
value Tailwind doesn't have a preset for), and `hover:`, `sm:`, `md:` prefixes (apply a utility
only on hover, or above a certain screen width). This is Tailwind's escape hatch for one-off
values without leaving the className string.

---

## 9. Key React hooks used in this project

| Hook | Used where | What it does |
|---|---|---|
| `useState` | `SubmissionWizard`, `Navbar`, login/signup forms | Local component state that triggers a re-render when changed |
| `useEffect` | `Navbar`, `GradientBackdrop` | Run code after render / on mount ("side effects") — e.g. fetching the current user, or attaching a `mousemove` listener |
| `useRef` | `GradientBackdrop`, `ImageDropzone` | Get a direct handle to a DOM element without causing re-renders when it changes |
| `useRouter` | login/signup, `DiscardDraftButton` | Programmatic navigation (`router.push('/dashboard')`) and `router.refresh()` (re-run server components without a full reload) |
| `useSearchParams` | `LoginPage` | Reads `?redirect=/submit`-style query params. **Must** be wrapped in `<Suspense>` — Next.js requires this because the value isn't known until the client hydrates |

---

## 10. How to make common changes

### Add a new field to the health form
1. Add it to `personalData` in `models/Submission.js`.
2. Add a matching key to `emptyPersonal` in `components/SubmissionWizard.jsx`.
3. Add an `<input>`/`<select>` for it inside `PersonalDataForm` in the same file, following the
   existing `set('fieldName', value)` pattern.
4. (Optional) Add it to the `fields` array in `ReviewStep` (same file) and in
   `app/profile/[id]/page.jsx` so it shows up in the review/detail views.

### Add a brand new page
1. Create `app/somename/page.jsx`. Exporting a default function makes `/somename` a real route
   automatically — no manual route registration needed.
2. If it needs to be login-protected, add `/somename` to the `matcher` array in `middleware.js`.
3. If it needs DB access and no interactivity, keep it a server component (no `'use client'`) and
   `await dbConnect()` directly inside it.

### Add a new API endpoint
1. Create `app/api/somename/route.js`.
2. Export `GET`/`POST`/etc. functions as needed, following the pattern in
   `app/api/submissions/route.js`.
3. Call `getCurrentUser()` first if the endpoint needs to know who's asking, and return 401 if
   there's no user.

### Change colors / overall look
Edit `tailwind.config.js` (`theme.extend.colors`) for global palette changes, or
`app/globals.css` (`.btn-primary`, `.glass-card`, etc.) for the shared component styles.

### Add a new step to the submission wizard
1. Bump the step count in `components/StepIndicator.jsx`'s `steps` array.
2. Add a new `{step === N && (...)}` block in `SubmissionWizard.jsx`'s render.
3. Add validation for that step inside `handleNext()`.

---

## 11. Deployment recap

- **Local dev**: `npm run dev`, needs `.env.local` with `MONGODB_URI` + `JWT_SECRET`.
- **Production (Vercel)**: push to GitHub, import into Vercel, set the same two env vars in the
  Vercel dashboard, deploy. No other config needed — Vercel auto-detects Next.js.
- **Database**: local Mongo works for dev; Vercel needs MongoDB Atlas (or any publicly-reachable
  Mongo instance) since it can't reach `localhost` on your machine.

---

## 12. Glossary (quick reference)

- **SSR (Server-Side Rendering)**: generating HTML on the server per-request. Server components
  do this by default.
- **Hydration**: the process where React "wakes up" the static HTML sent from the server and
  attaches interactivity in the browser. Only client components need this.
- **JWT (JSON Web Token)**: a signed, self-contained string encoding some data (here: user
  identity) that can be verified without a database lookup.
- **httpOnly cookie**: a cookie inaccessible to JavaScript (`document.cookie` can't read it) —
  reduces XSS attack surface for auth tokens.
- **Middleware**: code that runs before a request reaches its destination route.
- **Mongoose schema**: a JS-defined shape/validation layer on top of MongoDB's schema-less
  documents.
- **Serverless function**: a backend function (here, every API route) that spins up on-demand per
  request rather than running as an always-on server process.
- **base64 data URL**: a way of embedding binary data (like an image) as a plain text string,
  e.g. `data:image/jpeg;base64,/9j/4AAQ...` — lets us store images directly as a MongoDB string
  field instead of a separate file.
