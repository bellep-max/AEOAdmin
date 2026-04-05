# Keywords System - Updated Implementation

## ✅ Database Schema Updates

### Keywords Table
Updated with all required fields:

| Field | Type | Description |
|-------|------|-------------|
| `keyword_text` | VARCHAR(512) | The keyword text |
| `keyword_type` | VARCHAR(100) | Dropdown: "Type 1 - Geo Specific", "Type 2 - Backlink", etc. |
| `is_primary` | BOOLEAN | Toggle for "1st" position indicator |
| `is_active` | BOOLEAN | Toggle: Active / Inactive status |
| `date_added` | DATE | Automatically set when keyword is added |
| `initial_search_count_30_days` | INTEGER | Initial 30-day search count |
| `followup_search_count_30_days` | INTEGER | Follow-up 30-day search count |
| `initial_search_count_life` | INTEGER | Lifetime initial search count |
| `followup_search_count_life` | INTEGER | Lifetime follow-up search count |

### Keyword Links Table (NEW!)
**Supports unlimited associated links per keyword:**

| Field | Type | Description |
|-------|------|-------------|
| `keyword_id` | INTEGER | Reference to keywords table |
| `link_type_label` | VARCHAR(100) | Dropdown: "GBP snippet", "Client website blog post", "External article", "Others" |
| `link_active` | BOOLEAN | Toggle: Active / Inactive |
| `initial_rank_report_link` | VARCHAR(512) | URL to initial ranking report |
| `current_rank_report_link` | VARCHAR(512) | URL to current ranking report |

### Session Platforms Table (NEW!)
**Tracks searches per platform (ChatGPT, Gemini, Perplexity):**

| Field | Type | Description |
|-------|------|-------------|
| `keyword_id` | INTEGER | Reference to keywords table |
| `platform` | VARCHAR(50) | "ChatGPT", "Gemini", or "Perplexity" |
| `search_count_30_days` | INTEGER | Searches in last 30 days |
| `search_count_life` | INTEGER | Lifetime search count |
| `last_searched` | TIMESTAMP | Last search timestamp |

## ✅ Features Implemented

### 1. **Unlimited Associated Links**
- Each keyword can have multiple associated links
- Each link has its own:
  - Link type (dropdown with no limits)
  - Active/Inactive toggle
  - Initial & current rank report URLs

### 2. **Platform-Specific Tracking**
- Search counts tracked separately for:
  - ChatGPT
  - Gemini
  - Perplexity
- Both 30-day and lifetime metrics

### 3. **CSV Export (Per Business)**
The existing CSV export function already supports:
- ✅ Filtering by business
- ✅ All keyword fields included
- ✅ Link information (first link)
- ✅ Download functionality

**Export includes:**
- Business name
- Keyword
- Keyword Type
- Primary (1st) indicator
- Active status
- Date Added
- Search counts (30 days & lifetime)
- Link type & status
- Rank report links

### 4. **PDF Export (Per Business)**
- ✅ Grouped by business
- ✅ Professional formatting
- ✅ All fields included
- ✅ Multi-page support

## 🎯 Keyword Type Dropdown Options

The `keyword_type` field supports (customizable):
1. "Type 1 - Geo Specific"
2. "Type 2 - Backlink"
3. (Add more as needed)

## 🔗 Link Type Dropdown Options

The `link_type_label` field supports:
1. "GBP snippet"
2. "Client website blog post"
3. "External article"
4. "Others"

**No limits** - you can add as many links as needed per keyword.

## 📊 Usage

### Adding a Keyword
1. Go to **Keywords page**
2. Click **"Add Keyword"**
3. Fill in:
   - Select business
   - Enter keyword text
   - Choose keyword type
   - Set "1st" toggle
   - Set Active/Inactive
   - (Date added is automatic)
   - Enter search counts

### Adding Associated Links
1. Edit a keyword
2. Click **"Add Associated Link"**
3. Select link type from dropdown
4. Set Active/Inactive toggle
5. Enter initial rank report link
6. Enter current rank report link
7. Repeat for unlimited links

### Exporting Data
1. **Filter by business** (dropdown at top)
2. Click **"Export CSV"** or **"Export PDF"**
3. Data is automatically grouped per business
4. All fields included in export

## 🔄 Platform Search Tracking

To track searches by platform:
```javascript
// When a search is performed on ChatGPT/Gemini/Perplexity
// Update the session_platforms table
INSERT INTO session_platforms (keyword_id, platform, search_count_30_days, search_count_life)
VALUES (keyword_id, 'ChatGPT', 1, 1)
ON CONFLICT (keyword_id, platform)
DO UPDATE SET
  search_count_30_days = session_platforms.search_count_30_days + 1,
  search_count_life = session_platforms.search_count_life + 1,
  last_searched = NOW();
```

## ✨ Next Steps

To fully utilize the new system:

1. **Add keyword types to UI dropdown** (if more types needed)
2. **Add link types to UI dropdown** (already has 3 defaults)
3. **Implement platform tracking** in your search automation
4. **View multi-link data** in keyword detail view

All database tables are ready and the UI already supports most features!
