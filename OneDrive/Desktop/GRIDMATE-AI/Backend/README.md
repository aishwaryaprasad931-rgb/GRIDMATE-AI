# GRIDMATE AI Backend

Prototype backend for the GRIDMATE AI community energy marketplace.

## 1. Install

```bash
npm install
```

## 2. Configure

Copy `.env.example` to `.env` and change `JWT_SECRET`.

## 3. Run

```bash
npm run dev
```

Backend:
http://localhost:5000

Health check:
http://localhost:5000/api/health

## Demo accounts

Member:
- ID: HOUSE001
- Password: member123

Admin:
- ID: ADMIN001
- Password: admin123

## Main API routes

POST /api/auth/login
GET /api/me

GET /api/member/dashboard
POST /api/energy/requests
POST /api/energy/purchase
GET /api/member/transactions

GET /api/admin/dashboard
PATCH /api/admin/houses/:houseId

## Important

This backend is designed for a hackathon/demo prototype. It uses a JSON file as its database and a simulated wallet/payment system. For production deployment, use a real database, secure secret management, HTTPS, stronger validation/rate limiting, and a real payment provider.
