# 🚀 AEO Admin - Signal SEO Network Planner

A comprehensive **Admin Panel** for managing SEO businesses, keywords, and AI platform performance. Built with modern web technologies for production-ready performance and scalability.

## 📋 Features

### 🏢 Business Management
- **Complete Business Profiles** - Store all business information including GMB links, websites, and subscription details
- **Multi-Location Support** - Manage multiple business locations
- **Subscription Tracking** - Track billing, start dates, and plan information
- **Secure Credential Storage** - Store account credentials encrypted in database
- **Status Management** - Active/Inactive status tracking

### 🔑 Keyword Management
- **Keyword Tracking** - Add and manage keywords for each business
- **Ranking Reports** - Track keyword rankings and performance
- **Link Type Labels** - Support for GBP snippets and custom link types
- **Real-time Synchronization** - Live keyword updates across the application

### 📊 Analytics & Reporting
- **Dashboard** - Overview of network health and performance metrics
- **Metrics Tracking** - Track KPIs, sessions, and platform breakdown
- **Ranking Reports** - Weekly AI ranking reports
- **Session Activity** - Monitor AEO session logs and device activity

### 🔐 Authentication & Security
- **Admin User Management** - Secure login and session management
- **Role-Based Access** - Admin role support
- **Secure Credential Handling** - Database-backed credential storage
- **Session Persistence** - 7-day session expiration

### 🌓 User Experience
- **Light/Dark Mode** - Full dark mode support across entire application
- **Responsive Design** - Mobile-friendly interface
- **Consistent Typography** - Standardized font sizes and styling
- **Professional UI** - Built with shadcn/ui components

## 🏗️ Tech Stack

### Frontend
- **React 18** - Modern JavaScript UI framework
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - High-quality React components
- **React Hook Form** - Form state management
- **Zod** - TypeScript-first schema validation
- **React Query** - Server state management
- **Vite** - Lightning-fast build tool

### Backend
- **Express.js** - Lightweight Node.js framework
- **TypeScript** - Type-safe backend code
- **PostgreSQL** - Reliable relational database
- **Drizzle ORM** - TypeScript-first database toolkit
- **Pino** - Structured logging

### Development & DevOps
- **pnpm** - Fast monorepo package manager
- **Monorepo Setup** - Organized workspace structure
- **Orval** - OpenAPI code generation
- **Docker** - Containerization support

## 📦 Project Structure

```
SEO-Network-Planner/
├── artifacts/
│   ├── admin-panel/          # React frontend application
│   │   └── src/
│   │       ├── pages/        # Page components
│   │       ├── components/   # Reusable UI components
│   │       ├── hooks/        # Custom React hooks
│   │       └── lib/          # Utilities and helpers
│   └── api-server/           # Express backend server
│       └── src/
│           ├── routes/       # API endpoints
│           ├── lib/          # Business logic
│           └── middlewares/  # Express middleware
├── lib/
│   ├── db/                   # Database schema & setup
│   ├── api-spec/             # OpenAPI specification
│   ├── api-client-react/     # Generated React Query hooks
│   └── api-zod/              # Generated Zod schemas
├── scripts/                  # Database and setup scripts
└── package.json              # Workspace root config
```

## 🚀 Getting Started

### Prerequisites
- **Node.js** 18+ or **Docker**
- **PostgreSQL** 14+
- **pnpm** package manager

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/bellep-max/AEO-Admin.git
   cd AEO-Admin
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up database**
   ```bash
   # Create PostgreSQL database
   createdb seo_network_planner
   
   # Run migrations (if using Drizzle)
   pnpm run -C lib/db migrate
   ```

5. **Seed admin user**
   ```bash
   # Initialize admin user
   pnpm run -C artifacts/api-server seed-admin
   ```

### Running Locally

**Terminal 1: Start Backend Server**
```bash
cd artifacts/api-server
pnpm run dev
# Server runs on http://localhost:3000
```

**Terminal 2: Start Frontend Development Server**
```bash
cd artifacts/admin-panel
pnpm run dev
# Frontend runs on http://localhost:5173
```

### Default Credentials
```
Email: admin@signalaeo.com
Password: Admin123!
```

## 🔧 API Endpoints

### Clients (Businesses)
- `POST /api/clients` - Create new business
- `GET /api/clients` - List all businesses
- `GET /api/clients/:id` - Get business details
- `PATCH /api/clients/:id` - Update business
- `DELETE /api/clients/:id` - Delete business

### Keywords
- `POST /api/keywords` - Add keyword
- `GET /api/keywords` - List keywords (with optional clientId filter)
- `GET /api/keywords/:id/links` - Get keyword ranking links
- `POST /api/keywords/:id/links` - Add ranking link

### Dashboard
- `GET /api/dashboard/summary` - Dashboard statistics
- `GET /api/dashboard/session-activity` - Session activity data
- `GET /api/dashboard/platform-breakdown` - AI platform breakdown
- `GET /api/dashboard/network-health` - Network health metrics

### Health
- `GET /api/healthz` - Health check
- `POST /api/health/seed-admin` - Initialize admin user (dev only)

## 📊 Database Schema

### Main Tables
- **clients** - Business information (30+ fields)
- **keywords** - Keywords linked to businesses
- **keyword_links** - Ranking links and GMB snippets
- **ranking_reports** - Weekly AI ranking reports
- **users** - Admin user credentials
- **sessions** - User session data
- **devices** - Device farm management
- **proxies** - Proxy pool configuration

## 🔐 Data Management

### Adding Businesses
1. Log in with admin credentials
2. Navigate to **Business List** page
3. Click **Add Business** button
4. Fill in all required information:
   - Business name (required)
   - Search address & GMB details
   - Website information
   - Subscription details
   - Account credentials
   - Billing information
5. Submit form - data persists to PostgreSQL

### Adding Keywords
1. Click on a business in the list
2. Navigate to **Keywords** section
3. Add keywords with ranking links
4. Data automatically synced with database

### Removing Demo Data
To clear demo data and start fresh:
```bash
# Connect to database
psql seo_network_planner

# Run cleanup
DELETE FROM keywords;
DELETE FROM clients;
ALTER SEQUENCE clients_id_seq RESTART WITH 1;
ALTER SEQUENCE keywords_id_seq RESTART WITH 1;
```

## 🛠️ Development Workflow

### Code Generation
**Regenerate API client from OpenAPI spec:**
```bash
pnpm run -C lib/api-spec codegen
```

This generates:
- TypeScript React Query hooks
- Zod validation schemas
- API types and interfaces

### Building for Production

**Backend:**
```bash
cd artifacts/api-server
pnpm run build
pnpm run start
```

**Frontend:**
```bash
cd artifacts/admin-panel
pnpm run build
# Deploy `dist/` directory
```

### Running Tests
```bash
# Unit tests (if configured)
pnpm test

# Type checking
pnpm typecheck
```

## 📝 Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/seo_network_planner

# Server
PORT=3000
NODE_ENV=development

# Session & Security
SESSION_SECRET=your-secret-key

# API
API_BASE_URL=http://localhost:3000/api

# Frontend
VITE_API_URL=http://localhost:3000/api
```

## 🎨 Styling & Theming

### Tailwind CSS
- Utility-first CSS framework
- Responsive design system
- Dark mode support included

### Dark Mode
- Toggle via UI button
- Full `dark:` variant coverage
- Automatic persistence

### Components
- shadcn/ui component library
- Fully customizable
- Built on Radix UI & Tailwind

## 📱 Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is proprietary software. All rights reserved.

## 👨‍💼 Project Info

**Built by:** Signal AEO Team  
**Repository:** https://github.com/bellep-max/AEO-Admin  
**Last Updated:** April 2026

## 🆘 Support & Issues

For bugs, feature requests, or questions:
1. Check existing issues
2. Create new issue with detailed description
3. Include reproduction steps if reporting a bug

## 🚀 Deployment Guide

### Docker Deployment
```bash
# Build Docker images
docker-compose build

# Start services
docker-compose up -d
```

### Environment Configuration
1. Set all required `DATABASE_URL`, `SESSION_SECRET`
2. Configure `PORT` for backend (default: 3000)
3. Set `VITE_API_URL` in frontend env
4. Enable `NODE_ENV=production` for production builds

### Database Migrations
```bash
# Run pending migrations
pnpm run -C lib/db migrate

# Rollback last migration
pnpm run -C lib/db rollback
```

---

**Built with ❤️ for AEO Management**
