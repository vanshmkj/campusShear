# CampusShare

CampusShare is a responsive campus resource-sharing application built with HTML, CSS, vanilla JavaScript, Node.js, Express, and MySQL. Student card OCR/QR checks are an administrative review aid only; they do not prove that an ID card is genuine.

## Requirements

- Node.js 20.9 or newer and npm
- MySQL 8.0+ (InnoDB and FULLTEXT support)
- Network access on first use if Tesseract.js needs to download its English language data

## Install and start

1. Create a MySQL database and a dedicated application user. Grant that user access only to the CampusShare database. For example, run these statements from a privileged MySQL session, replacing the database password with a strong secret:

   ```sql
   CREATE DATABASE campusshare CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   CREATE USER 'campusshare'@'127.0.0.1' IDENTIFIED BY 'use-a-unique-secret';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER, REFERENCES ON campusshare.* TO 'campusshare'@'localhost';
   ```

2. Copy `.env.example` to `.env`. Set the MySQL connection values, a random `SESSION_SECRET` of at least 32 characters, your institution name, and the student-ID format options below. Replace the example ID format and college name with your institution’s actual values before starting the server. Set `APP_ORIGIN` to the exact origin serving the site, without a trailing slash.
3. Install packages and create the schema:

   ```sh
   npm install
   npm run db:setup
   ```

   The setup script only creates missing tables; it does not drop or reset existing data.
4. Create an administrator as described in [First administrator](#first-administrator).
5. Start the server:

   ```sh
   npm start
   ```

   Open `http://localhost:3000`. For development, `npm run dev` restarts the server when source files change.

Uploads are stored under `private_uploads/`, outside `public/`, with random server-generated names. In production, set `PRIVATE_UPLOAD_DIR` to a directory with restrictive filesystem permissions and persist it securely. Use HTTPS in production so session cookies can be marked Secure.

## Institution and student ID configuration

- `COLLEGE_NAME` is the institution name searched for in the OCR text.
- `COLLEGE_EMAIL_DOMAIN` is optional. When set (for example `students.example.edu`), registration requires that email domain. Set it to an empty value to disable domain enforcement if a campus uses multiple domains.
- `STUDENT_ID_REGEX` is required and is the complete, anchored regular expression used to validate an ID. One capture group must contain the four-digit batch year.
- `STUDENT_ID_BATCH_GROUP` is the one-based capture-group number containing that year.

The example `^CS-(20[0-9]{2})-[0-9]{4}$` recognizes IDs such as `CS-2027-0412`; group 1 is the batch year. Replace the pattern and capture-group number to reflect the actual campus ID scheme—do not use the example unless it matches your institution. During registration the extracted year must exist as an active row in `authorized_batches`. Administrators can add, activate, or deactivate years in the dashboard. Each protected student request and each login rechecks the active batch.

## First administrator

Set `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_STUDENT_ID`, and `ADMIN_PASSWORD` in the local environment for the one-time command. Use a unique password with at least 12 characters; keep it out of source control and clear the environment values after running the command:

```sh
npm run admin:create
```

The command hashes the password with bcrypt and creates an approved administrator account without assigning a student batch. It refuses to overwrite an existing account. Do not expose this command through the web application or run it with shared credentials.

## Verification and account review

Registration accepts JPEG, PNG, or WebP images up to 5 MB. The backend checks the image signature, uses Tesseract.js to look for the configured college name and student ID, and uses jsQR to look for the same ID in a QR payload. A mismatch or unreadable image is recorded as `manual_review`; matching checks are recorded as `passed`. Both states still require an administrator to approve the account. Neither state authenticates the ID card itself.

Only administrators can view uploaded ID images and review the extracted check results. Students can log in to see `pending`, `approved`, or `rejected` status; resource-sharing routes require an approved student and an active batch. Deactivating a batch blocks its students on their next login or protected request, including requests using an existing session.

## Security and operations

- Passwords are bcrypt-hashed; sessions use a MySQL-backed store and HttpOnly, SameSite cookies (Secure in production).
- State-changing API calls require a session CSRF token and same-origin requests. Authentication routes are rate-limited.
- Helmet security headers, restrictive Content Security Policy, input bounds, upload size/type checks, and parameterized SQL statements are enabled.
- Resource changes are owner-checked. Borrow acceptance and return update request and availability state together in database transactions.
- Back up the database and private upload directory together. Restrict administrator access and keep `.env` out of source control.

## Tests

Run the automated unit tests:

```sh
npm test
```

The tests cover configurable ID/batch parsing, QR-payload ID extraction, card-check matching and manual-review outcomes, and invalid ID-format configuration. With MySQL configured and the app running, use this acceptance checklist for the complete flows:

1. **Registration:** activate the configured batch as an admin; register with a valid ID and image; confirm a `pending` account and a private file. Repeat the email and ID and confirm both are rejected. Try a malformed ID, inactive batch, mismatched passwords, unsupported file, and oversized file and confirm each is rejected.
2. **Verification:** submit an image whose printed ID, QR ID, and college name match and confirm `passed`; submit a mismatched or unreadable image and confirm `manual_review`. Confirm neither result automatically approves the account and only admins can load the image.
3. **Login and batch authorization:** log in while pending and confirm the status page is available but resource mutations are blocked; approve the student and confirm access. Deactivate the batch and confirm login and protected requests are blocked, then reactivate it and confirm access returns.
4. **Resource sharing:** create, edit, filter/search, mark unavailable, and delete an owned listing. Confirm a different account cannot edit/delete it and an active loan prevents deletion.
5. **Borrowing:** send a request from another approved account; approve or reject it as the owner; confirm only one request can be approved for an available listing, status is reflected for both parties, and marking an approved loan returned makes the resource available again.

## API overview

- `GET /api/csrf`, `GET /api/auth/me`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/resources`, `GET /api/resources/:id`; approved students can use `GET /mine`, `POST /`, `PATCH /:id`, `DELETE /:id`, `GET /requests`, `POST /:id/requests`, `PATCH /requests/:id`, and `POST /requests/:id/return`
- Administrators can use `GET /api/admin/registrations`, `GET /api/admin/registrations/:id/id-card`, `PATCH /api/admin/registrations/:id`, `GET /api/admin/batches`, and `PUT /api/admin/batches/:year`

All state-changing API routes require the CSRF token returned by `GET /api/csrf` in the `X-CSRF-Token` header.
