# 🚀 SUPER PROMPT: DiscoverMake.com AI Template Marketplace
## Complete System Build Specification for LLM Implementation

---

## 📋 PROJECT OVERVIEW

You are building **DiscoverMake.com** - a premium marketplace for AI-powered Make.com automation templates. This is a complete web application that allows users to discover, purchase, and download professional automation templates with built-in affiliate revenue streams.

### Business Context:
- **Current State:** Operating marketplace with 7,500+ Make.com templates and 25 paying customers
- **Goal:** Scale to serve 100,000+ Make.com community with focus on AI-powered automation templates
- **Revenue Model:** Template sales ($19.99-$99.99) + bundles ($149-$299) + subscriptions ($99/month) + agency licenses ($499 + $99/month) + affiliate commissions (12-35%)
- **Year 1 Target:** $282,000 revenue with 86% profit margin
- **Unique Value:** First marketplace specifically for AI agent templates with comprehensive documentation and video tutorials

### Key Differentiators:
1. **AI-First:** Every template integrates Claude, GPT-4, or Gemini APIs
2. **Revenue-Focused:** Templates designed to save time or generate income
3. **Professional Quality:** 7-page documentation + video tutorials per template
4. **Affiliate Integration:** Make.com and Apify links embedded throughout
5. **Agency-Friendly:** White-label and resell rights available
6. **Community-Driven:** Discord, monthly Q&A, priority support

---

## 🎨 DESIGN REQUIREMENTS

### Design System:
Create a modern, professional marketplace that feels like a premium SaaS product.

#### Brand Identity:
- **Primary Color:** Deep purple/indigo (#667eea) - represents automation and AI
- **Secondary Color:** Vibrant cyan (#764ba2) - for CTAs and highlights
- **Accent Color:** Electric blue (#4facfe) - for success states and premium features
- **Neutral Palette:** 
  - Background: #ffffff (light) / #0f172a (dark)
  - Card background: #f8fafc / #1e293b
  - Text primary: #1e293b / #f1f5f9
  - Text secondary: #64748b / #94a3b8
- **Typography:**
  - Headings: Inter (font-weight: 700)
  - Body: Inter (font-weight: 400)
  - Code: JetBrains Mono
- **Corner Radius:** 12px (cards), 8px (buttons), 6px (inputs)
- **Shadows:** 
  - Light: 0 1px 3px rgba(0,0,0,0.1)
  - Medium: 0 4px 6px rgba(0,0,0,0.1)
  - Heavy: 0 10px 25px rgba(0,0,0,0.15)

#### Component Style Guidelines:

**Cards:**
```css
.template-card {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  padding: 24px;
  transition: all 0.3s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

.template-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(102,126,234,0.15);
  border-color: #667eea;
}
```

**Buttons:**
```css
.btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 0.2s;
  border: none;
  cursor: pointer;
}

.btn-primary:hover {
  transform: scale(1.02);
  box-shadow: 0 8px 16px rgba(102,126,234,0.3);
}

.btn-secondary {
  background: white;
  color: #667eea;
  border: 2px solid #667eea;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
}
```

**Badges:**
```css
.badge-ai-powered {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  color: white;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.badge-new {
  background: #10b981;
  color: white;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

.badge-bestseller {
  background: #f59e0b;
  color: white;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}
```

**Icons:**
- Use Lucide React icons throughout
- Size: 20px for inline icons, 24px for feature icons, 48px for section headers
- Color: Inherit from parent or use primary color
- Always include aria-labels for accessibility

#### Page Layouts:

**Homepage Layout:**
```
┌─────────────────────────────────────────┐
│ Navigation Bar (sticky)                 │
├─────────────────────────────────────────┤
│ Hero Section                            │
│ - Large headline                        │
│ - Subtitle with value prop             │
│ - CTA button (Browse Templates)        │
│ - Hero image/animation                 │
├─────────────────────────────────────────┤
│ Featured Templates (horizontal scroll) │
│ - 6 template cards                     │
│ - "View All" link                      │
├─────────────────────────────────────────┤
│ Categories Grid (3 columns)            │
│ - Content Creation                     │
│ - Marketing Automation                 │
│ - Customer Support                     │
│ - Research & Analysis                  │
│ - Financial Automation                 │
│ - More...                              │
├─────────────────────────────────────────┤
│ Stats Section                           │
│ - Total Templates                       │
│ - Happy Customers                       │
│ - 5-Star Reviews                        │
│ - Hours Saved                           │
├─────────────────────────────────────────┤
│ How It Works (3 steps)                  │
│ - Browse → Purchase → Import           │
├─────────────────────────────────────────┤
│ Testimonials Carousel                   │
├─────────────────────────────────────────┤
│ CTA Section (Subscribe)                 │
├─────────────────────────────────────────┤
│ Footer                                  │
└─────────────────────────────────────────┘
```

**Template Directory Layout:**
```
┌─────────────────────────────────────────┐
│ Navigation Bar                          │
├─────────────────────────────────────────┤
│ Page Header + Search Bar                │
├────────────┬────────────────────────────┤
│ Filters    │ Template Grid              │
│ Sidebar    │ - Card 1  Card 2  Card 3  │
│            │ - Card 4  Card 5  Card 6  │
│ Categories │ - Card 7  Card 8  Card 9  │
│ Price      │                            │
│ Complexity │ Pagination                 │
│ AI Model   │                            │
│ Features   │                            │
└────────────┴────────────────────────────┘
```

**Template Detail Page Layout:**
```
┌─────────────────────────────────────────┐
│ Navigation Bar                          │
├─────────────────────────────────────────┤
│ Breadcrumb                              │
├────────────────────┬────────────────────┤
│ Template Info      │ Purchase Card      │
│ - Title            │ - Price            │
│ - Description      │ - Buy Button       │
│ - Badges           │ - What's Included  │
│ - Screenshots      │ - Requirements     │
│                    │ - Affiliate Links  │
├────────────────────┴────────────────────┤
│ Tabs:                                   │
│ - Overview                              │
│ - Documentation                         │
│ - Video Tutorial                        │
│ - Reviews                               │
├─────────────────────────────────────────┤
│ Related Templates                       │
└─────────────────────────────────────────┘
```

#### Animations:
- Page transitions: 300ms ease-in-out
- Card hover: 200ms transform + shadow
- Button interactions: 150ms scale
- Loading states: Skeleton screens with shimmer effect
- Success states: Confetti animation (lightweight)
- Error states: Shake animation

---

## 🛠️ TECHNICAL STACK

### Frontend:
- **Framework:** Next.js 14+ (App Router)
- **Styling:** Tailwind CSS 3.4+
- **UI Components:** shadcn/ui (Radix UI primitives)
- **Icons:** Lucide React
- **Animations:** Framer Motion
- **State Management:** React Context + Zustand (for complex state)
- **Forms:** React Hook Form + Zod validation
- **Date/Time:** date-fns
- **Toast Notifications:** Sonner

### Backend:
- **API Routes:** Next.js API routes (App Router)
- **Database (Templates):** Airtable (existing 7,500+ templates)
- **Database (Orders):** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth
- **Payments:** Stripe Checkout + Webhooks
- **Email:** Resend (transactional) + SendGrid (marketing)
- **File Storage:** Supabase Storage (PDFs, videos, JSON files)
- **Analytics:** Vercel Analytics + PostHog

### Third-Party Integrations:
- **Make.com Affiliate:** Links with tracking
- **Apify Affiliate:** Links with tracking
- **Video Hosting:** Vimeo or YouTube (embeds)
- **CDN:** Vercel Edge Network
- **Error Tracking:** Sentry

---

## 📊 DATABASE SCHEMA

### Airtable Schema (Templates Data):

**Table: Templates**
```
Fields:
- id (Primary Key, auto-increment)
- name (Single line text)
- slug (Single line text, unique)
- short_description (Long text, 150 chars)
- full_description (Long text, markdown)
- category (Single select: Content Creation, Marketing, Support, etc.)
- subcategory (Single line text)
- price (Currency, USD)
- sale_price (Currency, USD, optional)
- complexity_level (Single select: Beginner, Intermediate, Advanced)
- ai_models_used (Multiple select: Claude, GPT-4, Gemini)
- required_services (Multiple select: Make.com, Apify, Claude API, etc.)
- estimated_setup_time (Number, minutes)
- monthly_cost_estimate (Currency, USD)
- monthly_hours_saved (Number)
- monthly_revenue_potential (Currency, USD, optional)
- make_json_file (Attachment)
- documentation_pdf (Attachment)
- video_tutorial_url (URL)
- cover_image (Attachment)
- screenshots (Attachments, multiple)
- tags (Multiple select)
- status (Single select: Draft, Published, Archived)
- created_at (Date)
- updated_at (Date)
- total_sales (Number, default: 0)
- average_rating (Number, 0-5)
- affiliate_make_link (URL)
- affiliate_apify_link (URL)
- affiliate_claude_link (URL)
- affiliate_other_links (Long text, JSON)
```

**Table: Bundles**
```
Fields:
- id (Primary Key)
- name (Single line text)
- slug (Single line text, unique)
- description (Long text, markdown)
- templates (Linked records to Templates)
- regular_price (Currency, calculated from templates)
- bundle_price (Currency, USD)
- discount_percentage (Number, calculated)
- cover_image (Attachment)
- status (Single select: Draft, Published)
- created_at (Date)
```

**Table: Categories**
```
Fields:
- id (Primary Key)
- name (Single line text)
- slug (Single line text, unique)
- description (Long text)
- icon (Single line text, Lucide icon name)
- template_count (Count from Templates)
- display_order (Number)
```

### Supabase Schema (Orders & Users):

**Table: users**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255),
  stripe_customer_id VARCHAR(255) UNIQUE,
  subscription_tier VARCHAR(50), -- null, 'monthly', 'annual'
  subscription_status VARCHAR(50), -- 'active', 'canceled', 'past_due'
  subscription_start_date TIMESTAMP,
  subscription_end_date TIMESTAMP,
  is_agency_partner BOOLEAN DEFAULT false,
  agency_license_status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);
```

**Table: orders**
```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  stripe_payment_intent_id VARCHAR(255) UNIQUE,
  stripe_session_id VARCHAR(255) UNIQUE,
  total_amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(50) NOT NULL, -- 'pending', 'completed', 'failed', 'refunded'
  payment_method VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
```

**Table: order_items**
```sql
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  item_type VARCHAR(50) NOT NULL, -- 'template', 'bundle', 'subscription'
  item_id VARCHAR(255) NOT NULL, -- Airtable record ID or product identifier
  item_name VARCHAR(255) NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
```

**Table: downloads**
```sql
CREATE TABLE downloads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  order_item_id UUID REFERENCES order_items(id),
  template_id VARCHAR(255) NOT NULL, -- Airtable record ID
  file_type VARCHAR(50) NOT NULL, -- 'json', 'pdf', 'video'
  download_count INTEGER DEFAULT 0,
  last_downloaded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_downloads_user_id ON downloads(user_id);
CREATE INDEX idx_downloads_template_id ON downloads(template_id);
```

**Table: reviews**
```sql
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  template_id VARCHAR(255) NOT NULL, -- Airtable record ID
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title VARCHAR(255),
  content TEXT,
  verified_purchase BOOLEAN DEFAULT false,
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_reviews_template_id ON reviews(template_id);
CREATE INDEX idx_reviews_user_id ON reviews(user_id);
CREATE INDEX idx_reviews_status ON reviews(status);
```

**Table: affiliate_tracking**
```sql
CREATE TABLE affiliate_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  template_id VARCHAR(255) NOT NULL,
  service VARCHAR(50) NOT NULL, -- 'make', 'apify', 'claude', etc.
  click_timestamp TIMESTAMP DEFAULT NOW(),
  source VARCHAR(50), -- 'documentation', 'email', 'video', etc.
  utm_params JSONB,
  converted BOOLEAN DEFAULT false,
  conversion_timestamp TIMESTAMP,
  estimated_commission DECIMAL(10,2)
);

CREATE INDEX idx_affiliate_tracking_user_id ON affiliate_tracking(user_id);
CREATE INDEX idx_affiliate_tracking_service ON affiliate_tracking(service);
```

---

## 🔌 API ROUTES

### Authentication Routes:

**POST /api/auth/signup**
```typescript
Request:
{
  email: string;
  password: string;
  fullName: string;
}

Response:
{
  success: boolean;
  user: {
    id: string;
    email: string;
    fullName: string;
  };
  session: {...};
}
```

**POST /api/auth/login**
```typescript
Request:
{
  email: string;
  password: string;
}

Response:
{
  success: boolean;
  user: {...};
  session: {...};
}
```

### Template Routes:

**GET /api/templates**
```typescript
Query Params:
{
  category?: string;
  search?: string;
  complexity?: 'Beginner' | 'Intermediate' | 'Advanced';
  aiModel?: 'Claude' | 'GPT-4' | 'Gemini';
  minPrice?: number;
  maxPrice?: number;
  sortBy?: 'popular' | 'newest' | 'price-low' | 'price-high' | 'rating';
  page?: number;
  limit?: number;
}

Response:
{
  templates: Template[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  filters: {
    categories: string[];
    complexityLevels: string[];
    aiModels: string[];
    priceRange: { min: number; max: number };
  };
}
```

**GET /api/templates/[slug]**
```typescript
Response:
{
  template: {
    id: string;
    name: string;
    slug: string;
    description: string;
    category: string;
    price: number;
    salePrice?: number;
    complexity: string;
    aiModels: string[];
    requiredServices: string[];
    setupTime: number;
    monthlyCost: number;
    hoursSaved: number;
    revenuePotential?: number;
    coverImage: string;
    screenshots: string[];
    tags: string[];
    totalSales: number;
    averageRating: number;
    affiliateLinks: {
      make: string;
      apify?: string;
      claude?: string;
      others?: Record<string, string>;
    };
    relatedTemplates: Template[];
  };
  hasAccess: boolean; // If user already purchased
}
```

**GET /api/templates/[slug]/download**
```typescript
Headers: Authorization: Bearer <token>

Query Params:
{
  fileType: 'json' | 'pdf' | 'video';
}

Response:
{
  downloadUrl: string; // Signed URL from Supabase Storage
  expiresIn: number; // Seconds
}
```

### Checkout Routes:

**POST /api/checkout/create-session**
```typescript
Request:
{
  items: Array<{
    type: 'template' | 'bundle' | 'subscription';
    id: string;
    quantity: number;
  }>;
  successUrl: string;
  cancelUrl: string;
}

Response:
{
  sessionId: string; // Stripe session ID
  url: string; // Redirect URL to Stripe Checkout
}
```

**POST /api/webhooks/stripe**
```typescript
// Stripe webhook handler
// Events: checkout.session.completed, payment_intent.succeeded, etc.
// Creates order records, sends confirmation emails, updates user access
```

### Order Routes:

**GET /api/orders**
```typescript
Headers: Authorization: Bearer <token>

Response:
{
  orders: Array<{
    id: string;
    orderNumber: string;
    totalAmount: number;
    status: string;
    items: Array<{
      itemName: string;
      itemType: string;
      quantity: number;
      totalPrice: number;
    }>;
    createdAt: string;
  }>;
}
```

**GET /api/orders/[id]**
```typescript
Headers: Authorization: Bearer <token>

Response:
{
  order: {
    id: string;
    orderNumber: string;
    totalAmount: number;
    status: string;
    paymentMethod: string;
    items: OrderItem[];
    downloadLinks: Array<{
      templateId: string;
      templateName: string;
      files: {
        json: string;
        pdf: string;
        video?: string;
      };
    }>;
    createdAt: string;
  };
}
```

### Affiliate Tracking Routes:

**POST /api/affiliate/track-click**
```typescript
Request:
{
  templateId: string;
  service: 'make' | 'apify' | 'claude';
  source: 'documentation' | 'email' | 'video' | 'website';
  utmParams?: Record<string, string>;
}

Response:
{
  success: boolean;
  trackingId: string;
}
```

**GET /api/affiliate/stats**
```typescript
Headers: Authorization: Bearer <token>

Response:
{
  totalClicks: number;
  conversions: number;
  estimatedCommissions: number;
  byService: {
    make: { clicks: number; conversions: number; commissions: number };
    apify: { clicks: number; conversions: number; commissions: number };
  };
}
```

### Admin Routes:

**GET /api/admin/analytics**
```typescript
Headers: Authorization: Bearer <admin_token>

Query Params:
{
  startDate: string;
  endDate: string;
}

Response:
{
  revenue: {
    total: number;
    templates: number;
    bundles: number;
    subscriptions: number;
  };
  sales: {
    totalOrders: number;
    templatesSold: number;
    bundlesSold: number;
  };
  topTemplates: Array<{
    id: string;
    name: string;
    sales: number;
    revenue: number;
  }>;
  affiliateRevenue: {
    totalCommissions: number;
    byService: Record<string, number>;
  };
}
```

---

## 🎯 KEY FEATURES IMPLEMENTATION

### 1. Affiliate Link Integration in Make.com JSON

**Critical Requirement:** Every exported Make.com JSON template must include affiliate links in the scenario itself.

**Implementation Strategy:**

#### Module 0: Welcome & Setup Guide (Note Module)
```json
{
  "id": 1,
  "module": "builtin:BasicAggregator",
  "version": 1,
  "parameters": {
    "note": "🚀 WELCOME TO YOUR AI AUTOMATION TEMPLATE!\n\n📋 SETUP CHECKLIST:\n\n✅ Step 1: Make.com Pro Account\nYou'll need Make.com Pro for this template.\nSign up: https://www.make.com/en/register?pc=YOUR_CODE&affiliateSource=template_import\n\n✅ Step 2: Apify Account\nFor web scraping functionality.\nSign up: https://affiliate.apify.com/YOUR_ID\n\n✅ Step 3: Claude API Key\nGet your API key: https://console.anthropic.com\n\n✅ Step 4: Configure Connections\nClick on each module with a warning icon and add your API keys.\n\n💡 TIP: This message will auto-hide after first successful run.\n\n📚 Full documentation: [LINK TO PDF]\n🎥 Video tutorial: [LINK TO VIDEO]\n\n💬 Need help? support@discovermake.com"
  },
  "mapper": {},
  "metadata": {
    "designer": {
      "x": 0,
      "y": 0
    },
    "restore": {},
    "expect": []
  }
}
```

#### Module 1: First-Run Check (Data Store)
```json
{
  "id": 2,
  "module": "gateway:CustomWebHook",
  "version": 1,
  "parameters": {},
  "filter": {
    "name": "Check if first run",
    "conditions": [
      [
        {
          "a": "{{datastore.get('first_run_complete')}}",
          "o": "text:notequal",
          "b": "true"
        }
      ]
    ]
  }
}
```

#### Module 2: Display Affiliate Info (Router with Email)
```json
{
  "id": 3,
  "module": "email:ActionSendEmail",
  "version": 3,
  "parameters": {},
  "mapper": {
    "to": "{{user.email}}",
    "subject": "Welcome! Setup Your Template",
    "html": "
      <h2>Welcome to Your New Automation Template!</h2>
      <p>Here's what you need to get started:</p>
      
      <h3>Required Services:</h3>
      <ul>
        <li>
          <strong>Make.com Pro</strong> ($16/month)<br>
          <a href='https://www.make.com/en/register?pc=YOUR_CODE&affiliateSource=template_email'>
            Sign up here →
          </a>
        </li>
        <li>
          <strong>Apify Starter</strong> ($49/month)<br>
          <a href='https://affiliate.apify.com/YOUR_ID'>
            Sign up here →
          </a>
        </li>
      </ul>
      
      <h3>Quick Start Guide:</h3>
      <ol>
        <li>Create accounts using links above</li>
        <li>Get your API keys</li>
        <li>Configure the modules in Make.com</li>
        <li>Run your first automation!</li>
      </ol>
      
      <p>
        <a href='[DOCUMENTATION_URL]'>📚 Full Documentation</a> | 
        <a href='[VIDEO_URL]'>🎥 Video Tutorial</a>
      </p>
    ",
    "from": "DiscoverMake <templates@discovermake.com>"
  }
}
```

#### Module 3: Mark First Run Complete
```json
{
  "id": 4,
  "module": "datastore:SetVariable",
  "version": 1,
  "parameters": {},
  "mapper": {
    "key": "first_run_complete",
    "value": "true",
    "ttl": "0"
  }
}
```

**JSON Template Structure:**
```json
{
  "name": "YouTube Automation Agent by DiscoverMake",
  "flow": [
    {
      "id": 1,
      "module": "builtin:BasicAggregator",
      "notes": "WELCOME & SETUP - Contains affiliate links"
    },
    {
      "id": 2,
      "module": "gateway:CheckFirstRun"
    },
    {
      "id": 3,
      "module": "email:SendSetupEmail"
    },
    {
      "id": 4,
      "module": "datastore:MarkComplete"
    },
    {
      "id": 5,
      "module": "http:ActionSendData",
      "notes": "Main Template Logic Starts Here"
    }
    // ... rest of template modules
  ],
  "metadata": {
    "version": 1,
    "designer": {
      "notes": [
        {
          "text": "AFFILIATE LINKS:\n• Make.com: https://make.com/...?pc=CODE\n• Apify: https://affiliate.apify.com/ID",
          "color": "blue",
          "position": { "x": 0, "y": -200 }
        }
      ]
    }
  }
}
```

### 2. Documentation PDF with Embedded Links

**Page 1: Overview**
```markdown
# YouTube Automation Agent
*By DiscoverMake.com*

## What This Template Does
Automatically generates YouTube video ideas, scripts, and schedules them based on trending topics.

## Value Proposition
⏱️ **Saves:** 18 hours/month of manual research
💰 **Potential Revenue:** $500-2,000/month from ad revenue
🎯 **Perfect For:** Content creators, agencies, marketers

## What You'll Need
To use this template, you'll need accounts with the following services:

### Make.com Pro Plan ($16/month)
The foundation of this automation. You'll need Pro because:
- Free tier only has 1,000 operations/month (this uses ~400 per run)
- Advanced integrations required
- Custom API connections

👉 **Sign up:** https://www.make.com/en/register?pc=YOUR_CODE&affiliateSource=pdf_doc

### Apify Starter Plan ($49/month)  
For YouTube trending topic scraping.
- Free tier ($5 credit/month) works for testing
- Starter plan needed for daily automation

👉 **Sign up:** https://affiliate.apify.com/YOUR_ID

### Claude API ($20/month estimated)
For generating video scripts and ideas.

👉 **Sign up:** https://console.anthropic.com

---

💡 **Total Monthly Investment:** ~$85/month
📈 **Expected ROI:** Week 1 (based on time saved)

---

📢 *Disclosure: DiscoverMake may earn commission from the Make.com and Apify links above. This helps us create more templates while keeping prices low. You pay the same price regardless.*
```

**Page 2-7:** Setup instructions, troubleshooting, etc. with affiliate links repeated in relevant sections.

### 3. Template Card Component

```tsx
// components/TemplateCard.tsx
import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Star, Clock, DollarSign, Zap } from 'lucide-react';

interface TemplateCardProps {
  template: {
    id: string;
    name: string;
    slug: string;
    shortDescription: string;
    price: number;
    salePrice?: number;
    coverImage: string;
    category: string;
    complexity: 'Beginner' | 'Intermediate' | 'Advanced';
    aiModels: string[];
    setupTime: number;
    averageRating: number;
    totalSales: number;
    hoursSaved?: number;
    revenuePotential?: number;
    badges?: ('new' | 'bestseller' | 'trending')[];
  };
}

export function TemplateCard({ template }: TemplateCardProps) {
  const discount = template.salePrice 
    ? Math.round(((template.price - template.salePrice) / template.price) * 100)
    : 0;

  return (
    <Link href={`/templates/${template.slug}`}>
      <div className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:border-purple-500 hover:shadow-xl hover:-translate-y-1">
        {/* Discount Badge */}
        {discount > 0 && (
          <div className="absolute top-3 left-3 z-10 bg-red-500 text-white px-3 py-1 rounded-full text-sm font-bold">
            {discount}% OFF
          </div>
        )}

        {/* Status Badges */}
        <div className="absolute top-3 right-3 z-10 flex gap-2">
          {template.badges?.map((badge) => (
            <Badge key={badge} variant={badge}>
              {badge}
            </Badge>
          ))}
        </div>

        {/* Cover Image */}
        <div className="relative h-48 w-full overflow-hidden bg-gradient-to-br from-purple-100 to-blue-100">
          <Image
            src={template.coverImage}
            alt={template.name}
            fill
            className="object-cover transition-transform group-hover:scale-105"
          />
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Category & Complexity */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-purple-600">
              {template.category}
            </span>
            <Badge variant="outline" className="text-xs">
              {template.complexity}
            </Badge>
          </div>

          {/* Title */}
          <h3 className="text-lg font-bold text-gray-900 mb-2 line-clamp-2 group-hover:text-purple-600">
            {template.name}
          </h3>

          {/* Description */}
          <p className="text-sm text-gray-600 mb-4 line-clamp-2">
            {template.shortDescription}
          </p>

          {/* AI Models */}
          <div className="flex gap-2 mb-4">
            {template.aiModels.map((model) => (
              <Badge key={model} className="ai-badge">
                <Zap className="w-3 h-3 mr-1" />
                {model}
              </Badge>
            ))}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 mb-4 text-xs text-gray-600">
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>{template.setupTime} min setup</span>
            </div>
            {template.hoursSaved && (
              <div className="flex items-center gap-1">
                <Zap className="w-4 h-4" />
                <span>Saves {template.hoursSaved}h/mo</span>
              </div>
            )}
            {template.revenuePotential && (
              <div className="flex items-center gap-1">
                <DollarSign className="w-4 h-4" />
                <span>${template.revenuePotential}/mo potential</span>
              </div>
            )}
          </div>

          {/* Rating & Sales */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-1">
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              <span className="text-sm font-medium">
                {template.averageRating.toFixed(1)}
              </span>
              <span className="text-xs text-gray-500">
                ({template.totalSales} sales)
              </span>
            </div>
          </div>

          {/* Price & CTA */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div>
              {template.salePrice ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-purple-600">
                    ${template.salePrice}
                  </span>
                  <span className="text-sm text-gray-400 line-through">
                    ${template.price}
                  </span>
                </div>
              ) : (
                <span className="text-2xl font-bold text-purple-600">
                  ${template.price}
                </span>
              )}
            </div>
            <Button className="btn-primary">
              View Details
            </Button>
          </div>
        </div>
      </div>
    </Link>
  );
}
```

### 4. Checkout Flow

```tsx
// app/checkout/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_KEY!);

export default function CheckoutPage({ searchParams }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { items } = searchParams; // Encoded cart items

  const handleCheckout = async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/checkout/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: JSON.parse(decodeURIComponent(items)),
          successUrl: `${window.location.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/templates`,
        }),
      });

      const { sessionId } = await response.json();
      const stripe = await stripePromise;
      
      await stripe?.redirectToCheckout({ sessionId });
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-12">
      <h1 className="text-3xl font-bold mb-8">Checkout</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Order Summary */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            {/* Cart items here */}
          </Card>
        </div>

        {/* Payment Summary */}
        <div>
          <Card className="p-6 sticky top-24">
            <h3 className="text-xl font-bold mb-4">Order Summary</h3>
            
            {/* Pricing breakdown */}
            
            <Button 
              onClick={handleCheckout}
              disabled={loading}
              className="w-full btn-primary"
            >
              {loading ? 'Processing...' : 'Complete Purchase'}
            </Button>

            <div className="mt-6 space-y-3 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                <span>Secure payment via Stripe</span>
              </div>
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                <span>Instant download after purchase</span>
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                <span>30-day money-back guarantee</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
```

### 5. Admin Dashboard

```tsx
// app/admin/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { 
  DollarSign, 
  ShoppingCart, 
  TrendingUp, 
  Users 
} from 'lucide-react';

export default function AdminDashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/analytics')
      .then(res => res.json())
      .then(data => {
        setAnalytics(data);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Revenue</p>
              <p className="text-2xl font-bold">
                ${analytics.revenue.total.toLocaleString()}
              </p>
            </div>
            <DollarSign className="w-10 h-10 text-green-500" />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            +{analytics.revenue.growth}% from last month
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Orders</p>
              <p className="text-2xl font-bold">
                {analytics.sales.totalOrders}
              </p>
            </div>
            <ShoppingCart className="w-10 h-10 text-blue-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Affiliate Revenue</p>
              <p className="text-2xl font-bold">
                ${analytics.affiliateRevenue.totalCommissions.toLocaleString()}
              </p>
            </div>
            <TrendingUp className="w-10 h-10 text-purple-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active Subscribers</p>
              <p className="text-2xl font-bold">
                {analytics.subscriptions.active}
              </p>
            </div>
            <Users className="w-10 h-10 text-orange-500" />
          </div>
        </Card>
      </div>

      {/* Charts & Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Revenue Chart */}
        <Card className="p-6">
          <h3 className="text-lg font-bold mb-4">Revenue by Stream</h3>
          {/* Add chart component */}
        </Card>

        {/* Top Templates */}
        <Card className="p-6">
          <h3 className="text-lg font-bold mb-4">Top Selling Templates</h3>
          <div className="space-y-4">
            {analytics.topTemplates.map((template, idx) => (
              <div key={template.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-gray-400">
                    #{idx + 1}
                  </span>
                  <div>
                    <p className="font-medium">{template.name}</p>
                    <p className="text-sm text-gray-500">
                      {template.sales} sales
                    </p>
                  </div>
                </div>
                <p className="font-bold text-green-600">
                  ${template.revenue.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
```

---

## 🚀 DEPLOYMENT & ENVIRONMENT

### Environment Variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Airtable
AIRTABLE_API_KEY=your-api-key
AIRTABLE_BASE_ID=your-base-id
AIRTABLE_TEMPLATES_TABLE=Templates
AIRTABLE_BUNDLES_TABLE=Bundles

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Resend (Email)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=templates@discovermake.com

# Affiliate Codes
MAKE_AFFILIATE_CODE=your-make-code
APIFY_AFFILIATE_ID=your-apify-id

# Admin
ADMIN_EMAIL=admin@discovermake.com

# Analytics
NEXT_PUBLIC_POSTHOG_KEY=phc_...
SENTRY_DSN=https://...
```

### Deployment Checklist:

```
[ ] Set up Supabase project
[ ] Create database tables (run migration SQL)
[ ] Set up Stripe account & products
[ ] Configure Stripe webhook endpoint
[ ] Set up Airtable base & import templates
[ ] Apply for Make.com affiliate program
[ ] Apply for Apify affiliate program
[ ] Set up Resend/SendGrid for emails
[ ] Configure custom domain
[ ] Set up SSL certificate
[ ] Configure Vercel environment variables
[ ] Test checkout flow end-to-end
[ ] Test email delivery
[ ] Test download links
[ ] Set up error monitoring (Sentry)
[ ] Set up analytics (PostHog)
[ ] Create admin user account
[ ] Populate initial templates
[ ] Test affiliate link tracking
```

---

## 📱 MOBILE RESPONSIVENESS

All pages must be fully responsive:

```css
/* Breakpoints */
sm: 640px   /* Mobile landscape */
md: 768px   /* Tablet */
lg: 1024px  /* Desktop */
xl: 1280px  /* Large desktop */
2xl: 1536px /* Extra large */

/* Mobile-first approach */
/* Base styles for mobile */
/* Use @media (min-width: X) for larger screens */
```

**Key Mobile Considerations:**
- Touch-friendly buttons (min 44px height)
- Readable font sizes (16px minimum)
- Adequate spacing (16px padding)
- Hamburger menu for navigation
- Sticky bottom CTA on mobile product pages
- Swipeable image galleries
- Collapsible filter sidebar on mobile

---

## 🎯 PERFORMANCE REQUIREMENTS

### Core Web Vitals Targets:
- **LCP (Largest Contentful Paint):** < 2.5s
- **FID (First Input Delay):** < 100ms
- **CLS (Cumulative Layout Shift):** < 0.1

### Optimization Strategies:
- Image optimization (Next.js Image component)
- Code splitting (dynamic imports)
- Server-side rendering for SEO
- Static generation where possible
- CDN caching (Vercel Edge)
- Database query optimization
- Lazy loading below fold content
- Prefetch critical resources

---

## 🔒 SECURITY REQUIREMENTS

### Authentication:
- Supabase Auth with email/password
- Optional: Google/GitHub OAuth
- Email verification required
- Password reset flow
- Session management

### Data Protection:
- HTTPS everywhere (enforce)
- Secure cookie settings
- CSRF protection
- XSS prevention (sanitize inputs)
- SQL injection prevention (parameterized queries)
- Rate limiting on API routes
- Stripe webhook signature verification

### Access Control:
- Row-level security (Supabase RLS)
- User can only access own orders
- Admin role for dashboard access
- Download links expire after 24 hours

---

## 📧 EMAIL TEMPLATES

### Purchase Confirmation Email:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: 'Inter', sans-serif; background-color: #f8fafc; padding: 40px 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 28px;">
        🎉 Purchase Successful!
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">
        Thank you for your purchase from DiscoverMake
      </p>
    </div>

    <!-- Order Details -->
    <div style="padding: 40px;">
      <h2 style="margin: 0 0 20px 0; font-size: 20px; color: #1e293b;">
        Order #{{ORDER_NUMBER}}
      </h2>

      <!-- Items -->
      <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
        {{#each ITEMS}}
        <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
          <div>
            <p style="margin: 0; font-weight: 600; color: #1e293b;">
              {{this.name}}
            </p>
            <p style="margin: 5px 0 0 0; font-size: 14px; color: #64748b;">
              {{this.type}}
            </p>
          </div>
          <p style="margin: 0; font-weight: 600; color: #667eea;">
            ${{this.price}}
          </p>
        </div>
        {{/each}}

        <div style="border-top: 2px solid #e2e8f0; padding-top: 15px; margin-top: 15px;">
          <div style="display: flex; justify-content: space-between;">
            <p style="margin: 0; font-weight: 700; font-size: 18px;">Total</p>
            <p style="margin: 0; font-weight: 700; font-size: 18px; color: #667eea;">
              ${{TOTAL}}
            </p>
          </div>
        </div>
      </div>

      <!-- Download Button -->
      <a href="{{DOWNLOAD_URL}}" style="display: block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center; padding: 16px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
        📥 Download Your Templates
      </a>

      <!-- Setup Guide -->
      <div style="background: #f1f5f9; border-radius: 8px; padding: 20px; margin-top: 30px;">
        <h3 style="margin: 0 0 15px 0; color: #1e293b;">🚀 Quick Setup Guide</h3>
        <ol style="margin: 0; padding-left: 20px; color: #475569;">
          <li style="margin-bottom: 10px;">
            <strong>Set up your accounts:</strong>
            <ul style="margin: 5px 0; padding-left: 20px;">
              <li>
                <a href="https://www.make.com/en/register?pc={{MAKE_CODE}}&affiliateSource=purchase_email" style="color: #667eea;">
                  Make.com Pro
                </a> ($16/month)
              </li>
              <li>
                <a href="https://affiliate.apify.com/{{APIFY_ID}}" style="color: #667eea;">
                  Apify
                </a> (Free to start)
              </li>
            </ul>
          </li>
          <li style="margin-bottom: 10px;">Import the JSON file into Make.com</li>
          <li style="margin-bottom: 10px;">Configure your API keys</li>
          <li>Watch the video tutorial for step-by-step guidance</li>
        </ol>
      </div>

      <!-- Support -->
      <div style="text-align: center; margin-top: 30px; padding-top: 30px; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0 0 10px 0; color: #64748b;">
          Need help getting started?
        </p>
        <a href="mailto:support@discovermake.com" style="color: #667eea; text-decoration: none; font-weight: 600;">
          Contact Support →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
      <p style="margin: 0 0 10px 0; color: #64748b; font-size: 14px;">
        DiscoverMake.com - Premium Make.com Templates
      </p>
      <p style="margin: 0; color: #94a3b8; font-size: 12px;">
        © 2025 DiscoverMake. All rights reserved.
      </p>
    </div>

  </div>
</body>
</html>
```

---

## ✅ TESTING REQUIREMENTS

### Unit Tests:
- API route handlers
- Utility functions
- Data transformations
- Validation logic

### Integration Tests:
- Checkout flow
- Email delivery
- Webhook processing
- Database operations

### E2E Tests (Playwright):
- Browse templates
- Add to cart
- Complete purchase
- Download files
- User registration
- Password reset

### Performance Tests:
- Load testing (100 concurrent users)
- Database query performance
- API response times
- Image loading speed

---

## 📦 DEPLOYMENT STEPS

1. **Initial Setup:**
   ```bash
   npm create next-app@latest discovermake
   cd discovermake
   npm install @supabase/supabase-js stripe @stripe/stripe-js
   npm install -D tailwindcss postcss autoprefixer
   npx tailwindcss init -p
   ```

2. **Configure Supabase:**
   - Create project
   - Run database migrations
   - Set up RLS policies
   - Configure storage buckets

3. **Configure Stripe:**
   - Create products
   - Set up webhook endpoint
   - Test webhook locally

4. **Deploy to Vercel:**
   ```bash
   vercel
   vercel --prod
   ```

5. **Post-Deployment:**
   - Verify environment variables
   - Test checkout flow
   - Test email delivery
   - Monitor error logs
   - Set up alerts

---

## 🎯 SUCCESS CRITERIA

The application is considered complete when:

✅ **Functionality:**
- [ ] Users can browse templates with filters
- [ ] Search works accurately
- [ ] Checkout flow completes successfully
- [ ] Emails are sent automatically
- [ ] Downloads work reliably
- [ ] Affiliate links track properly
- [ ] Admin dashboard shows accurate data

✅ **Performance:**
- [ ] LCP < 2.5s on all pages
- [ ] Mobile performance score > 90
- [ ] No console errors
- [ ] All images optimized

✅ **Design:**
- [ ] Matches design system
- [ ] Fully responsive
- [ ] Animations work smoothly
- [ ] Dark mode (optional)

✅ **Business:**
- [ ] Stripe integration works
- [ ] Affiliate tracking works
- [ ] Revenue reporting accurate
- [ ] Customer journey optimized

---

## 🚀 FINAL INSTRUCTIONS FOR LLM

When implementing this application:

1. **Start with Core Features:**
   - Set up Next.js project with Tailwind
   - Create database schema in Supabase
   - Implement template browsing
   - Build checkout flow
   - Set up admin dashboard

2. **Prioritize User Experience:**
   - Fast page loads
   - Smooth animations
   - Clear CTAs
   - Helpful error messages
   - Mobile-first design

3. **Ensure Quality:**
   - Write clean, documented code
   - Follow TypeScript best practices
   - Implement proper error handling
   - Add loading states everywhere
   - Test thoroughly

4. **Embed Affiliate Links:**
   - In Make.com JSON templates (Module 0)
   - In documentation PDFs
   - In email templates
   - On template detail pages
   - Track clicks and conversions

5. **Optimize for SEO:**
   - Meta tags on every page
   - Structured data for products
   - Clean URLs
   - Fast loading
   - Mobile responsive

6. **Security First:**
   - Validate all inputs
   - Sanitize user data
   - Secure API routes
   - Protect against CSRF/XSS
   - Use environment variables

**Build this as a production-ready, scalable, beautiful marketplace that users love and generates $282K+ in Year 1 revenue! 🚀**
