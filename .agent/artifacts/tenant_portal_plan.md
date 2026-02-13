# ImmoControlpro360 — Tenant Portal Implementation

## ✅ Completed

### Phase 1: Foundation
- [x] **Database Migration** (`supabase/migrations/001_tenant_portal.sql`)
  - `user_roles` — Maps auth.users to investor/tenant role
  - `announcements` — Property-wide announcements
  - `tickets` — Maintenance/issue tickets with status workflow
  - `messages` — Real-time chat messages
  - `tenant_invitations` — Magic Link invitation tracking
  - RLS Policies for all tables
  - Indexes and Realtime publication (messages + tickets)

- [x] **Auth Context Extension** (`src/context/AuthContext.jsx`)
  - Fetches `user_roles` on login
  - Provides `userRole`, `roleData`, `isInvestor`, `isTenant`
  - Backward-compatible: users without role entry → `investor`

- [x] **Role-Based Sidebar** (`src/components/layout/Sidebar.jsx`)
  - Investor: Full nav + "Mieterportal" section (Mieter-Verwaltung, Ticket-Board, Aushänge, Nachrichten)
  - Tenant: Dashboard, Tickets, Nachrichten, Aushang, Dokumente
  
- [x] **Role-Based Topbar** (`src/components/layout/Topbar.jsx`)
  - Portfolio selector for investors only
  - "Mieterportal" badge for tenants

- [x] **Routing** (`src/App.jsx`)
  - `RoleBasedIndex` redirects tenants to `/tenant`
  - All investor portal routes: `/tenant-management`, `/ticket-board`, `/announcements`, `/investor-messages`
  - All tenant routes: `/tenant`, `/tenant/tickets`, `/tenant/messages`, `/tenant/announcements`, `/tenant/documents`

### Phase 2: Invitation System
- [x] **TenantManagement.jsx** — Invite tenants via Magic Link (Supabase `signInWithOtp`)
  - Select existing tenant record
  - Auto-link unit/property from active lease
  - Track invitation status (pending/accepted)

### Phase 3: Tenant Interface
- [x] **TenantDashboard.jsx** — Address card, KPIs (total rent, cold rent, utilities, lease start), contract details, recent tickets
- [x] **TenantAnnouncements.jsx** — Read-only bulletin board scoped to tenant's property
- [x] **TenantDocuments.jsx** — Two tabs (General / Personal), download from Supabase Storage

### Phase 4: Ticket System
- [x] **TenantTickets.jsx** — Create tickets (title, description, priority, photo upload), view ticket list with progress bars, detail modal, Realtime updates
- [x] **TicketKanban.jsx** — Investor Kanban board with `@dnd-kit/core` drag & drop
  - 3 columns: Eingegangen → In Bearbeitung → Abgeschlossen
  - **Auto-notification**: When ticket status changes, a system message is sent to the tenant's messenger
  - Tenant name + unit resolution

### Phase 5: Messenger
- [x] **Messenger.jsx** — Shared real-time chat component
  - Supabase Realtime subscription for instant messages
  - Date groupings, chat bubbles, system message styling (for ticket status)
  - File attachment upload to `chat-attachments` bucket
  - Auto-read marking
- [x] **TenantMessages.jsx** — Direct chat with investor
- [x] **InvestorMessages.jsx** — Conversation list with all registered tenants, unread badges, last message preview, search

### Phase 6: Announcements (Investor)
- [x] **Announcements.jsx** — Full CRUD for property-scoped announcements

## 📦 Dependencies
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — Drag & drop for Kanban board

## 🔧 Setup Steps

### 1. Run SQL Migration
Go to Supabase Dashboard → SQL Editor → Paste contents of `supabase/migrations/001_tenant_portal.sql` → Run

### 2. Create Storage Buckets (optional)
```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('tickets', 'tickets', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-attachments', 'chat-attachments', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('tenant-documents', 'tenant-documents', false);
```

### 3. Create Investor Role (for your existing user)
```sql
INSERT INTO user_roles (user_id, role)
SELECT id, 'investor' FROM auth.users WHERE email = 'your-email@example.com';
```

### 4. Invite a Tenant
1. Go to `/tenant-management`
2. Select tenant → Enter email → Send invitation
3. Tenant receives Magic Link email → clicks → auto-registered as tenant role

## 🔄 Automatic Notifications
When investor drags a ticket on the Kanban board to a new status column, a **system message** is automatically sent to the tenant's messenger:
> 📋 Ihr Ticket "Heizung defekt" wurde auf "In Bearbeitung" aktualisiert.

This appears as a styled system message (blue badge with bot icon) in the chat.
