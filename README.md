# LCO CONNECT

Unified Customer & Service Management for Local Connectivity Providers.

One simple platform for customer management, billing, complaints, technicians and local service communication — built for cable, broadband and Wi-Fi operators.

**Live:** [lcoconnect.in](https://lcoconnect.in) · **Contact:** [support@lcoconnect.in](mailto:support@lcoconnect.in)

## Overview

LCO CONNECT is a multi-tenant SaaS platform for Local Cable Operators (LCOs). An operator registers, gets verified by the platform team, and then runs their entire business — customers, plans, billing, payments, service requests and field technicians — from a single dashboard. Customers and technicians get their own portals, and the platform is governed by a Super Admin console.

## Portals

| Portal | Who uses it | What they can do |
|--------|-------------|------------------|
| **Super Admin** | Platform team | Verify or reject LCO applications (with document review), suspend/reactivate accounts, resend activation invitations, oversee users and communications, and review the audit & security log |
| **LCO Admin** | Cable / broadband operators | Manage customers and plans, assign subscriptions, generate bills, record payments, manage technicians, handle service requests, and send broadcasts and urgent notices |
| **Customer** | Subscribers | View their subscription and bills, pay online, raise service requests, request plans, and receive notifications |
| **Technician** | Field staff | Work on assigned service tickets, update notes, and mark issues resolved |

## Key Flows

- **LCO registration** — multi-step application with document upload (business/registration proof, owner ID proof, optional supporting document) and a public application-status page.
- **Approval & activation** — Super Admin approval triggers a branded invitation email; one unified **Activate Account** page serves LCOs, customers and technicians, who set their password and land on their own dashboard.
- **Forgot password** — branded reset email with a dedicated reset page.
- **Billing & payments** — bill generation, payment recording, and online payments via Razorpay and Cashfree.
- **Notifications** — in-app notification centres per portal, plus email notifications for key events.

## Technology

- **Frontend:** HTML5, CSS3 and vanilla JavaScript — no build step
- **Backend:** Supabase — PostgreSQL database with row-level security, Auth, Storage (verification documents) and Edge Functions (Deno)
- **Email:** SMTP2GO, sent from the platform domain (`support@lcoconnect.in`); incoming mail is received on the same address
- **Payments:** Razorpay & Cashfree (order creation, verification and webhooks as Edge Functions)
- **Hosting:** Vercel, served on the custom domain **lcoconnect.in**

## Project Structure

```
LCO-CONNECT/
│
├── index.html                 # Landing page
├── pages/                     # Login, registration, status, activation & the 4 dashboards
│   ├── login.html
│   ├── register-lco.html
│   ├── application-status.html
│   ├── activate-account.html  # Unified activation (LCO / customer / technician)
│   ├── reset-password.html
│   ├── super-admin.html
│   ├── lco-dashboard.html
│   ├── customer-dashboard.html
│   └── technician-dashboard.html
│
├── css/                       # Landing + per-portal stylesheets
├── js/                        # Landing, auth, registration + per-portal logic
├── supabase/
│   └── functions/             # Edge Functions: invitations, password reset,
│                              # notifications, payments & webhooks
├── sql/                       # Database schema & phase migrations (25 files)
└── README.md
```

## Running Locally

No build step — open `index.html` in a browser, or serve the folder:

```bash
# Python
python -m http.server 8000

# Node.js (if npx available)
npx serve .
```

The app talks to the hosted Supabase project, so an internet connection is required for login and data.

## Project Status

_Last updated: 25 October 2026_

- ✅ Live in production on [lcoconnect.in](https://lcoconnect.in)
- ✅ All four portals (Super Admin, LCO Admin, Customer, Technician) built and working
- ✅ Registration → verification → approval → email activation flow working end to end
- ✅ Forgot-password flow live
- ✅ Business email (`support@lcoconnect.in`) configured for sending and receiving, and wired into the landing page
- ✅ Super Admin console reviewed and fixed (suspend flow, resend invitations, audit & security view)
- 🔄 Final review pass of the LCO, Technician and Customer dashboards in progress, ahead of the project review on 29 October 2026

## License

© 2026 LCO Connect. All rights reserved.
