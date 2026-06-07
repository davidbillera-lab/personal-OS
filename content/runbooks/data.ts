import type { Runbook } from './types'

export const runbooks: Runbook[] = [
  // ─── Tier 1: Cash + Scale ───────────────────────────────────────

  {
    slug: 'jsg-estate',
    name: 'JSG Estate Liquidators',
    tagline: 'Estate liquidation and consignment for Denver metro families.',
    description:
      'When a family needs to sell off belongings after a passing, a downsizing, or a property clear-out, JSG comes in, catalogs everything, and sells it through online auctions and marketplace listings. This is the cash-flowing engine of the whole portfolio.',
    tier: 1,
    stage: 'active',
    emoji: '🏡',
    revenue_model: 'Commission on gross sales (typically 35–40% to JSG)',
    chapters: [
      {
        id: 'what',
        icon: '🏡',
        title: 'What Is This Business?',
        type: 'text',
        content:
          'JSG Estate Liquidators helps families and estate trustees sell personal property — furniture, collectibles, artwork, tools, jewelry, household goods — quickly and for fair market value. We catalog everything, price it using AI research tools, list it across multiple online platforms, and handle all buyer communication and shipping. The family gets a check; we keep our commission.\n\nMost clients come to us in difficult situations — someone passed away, a house is being sold, or a major downsizing is happening. We handle the hard part professionally and leave them with clean closure.',
      },
      {
        id: 'roles',
        icon: '👥',
        title: 'Who Does What',
        type: 'roles',
        roles: [
          {
            who: 'David',
            does: 'Strategy, client relationships for large estates, pricing decisions on high-value items, platform oversight',
            level: 'full',
          },
          {
            who: 'Vinnie',
            does: 'Day-to-day operations: photographing items, creating listings, shipping sold items, responding to buyers, on-site pickups',
            level: 'full',
          },
          {
            who: 'Clients (estate families)',
            does: 'Sign consignment agreement. Provide access to the property. Review settlement statement.',
            level: 'limited',
          },
          {
            who: 'Buyers',
            does: 'Bid or buy through auction platforms (DOA, LiveAuctioneers) or direct marketplaces (eBay, Mercari, etc.)',
            level: 'view-only',
          },
        ],
      },
      {
        id: 'process',
        icon: '📋',
        title: 'The Process, Step by Step',
        type: 'steps',
        intro:
          'Every JSG job follows the same sequence. Knowing this end-to-end makes it easy to answer client questions and know what\'s next at any stage.',
        steps: [
          {
            title: 'Client intake and walkthrough',
            detail: 'Schedule a walkthrough of the property. Meet the client, understand the timeline, assess the volume of goods. Sign the consignment agreement (template in Google Drive).',
            tip: 'Take photos of every room during the walkthrough — this is your before-state documentation.',
          },
          {
            title: 'Catalog every item',
            detail: 'Vinnie photographs all items. VZT (our AI tool) analyzes photos and suggests what each item is and what it\'s worth. Every item gets a record.',
            tip: 'If an item looks unusual or potentially high-value, flag it for David before pricing.',
          },
          {
            title: 'Pricing review',
            detail: 'VZT generates a starting price based on comparable sold prices. Vinnie reviews and confirms, or adjusts. David signs off on anything over $200.',
          },
          {
            title: 'List on platforms',
            detail: 'Items go up on the right platform based on type: auctions (DOA, LiveAuctioneers) for collectibles and furniture; eBay for general goods; Mercari/Poshmark for fashion and household; Etsy for vintage and handmade.',
          },
          {
            title: 'Run the auction / sale period',
            detail: 'Auctions run 3–7 days. Answer buyer questions promptly. Watch for obviously underpriced items that are getting heavy bidding — flag to David if we need to pull and relist.',
          },
          {
            title: 'Close and settle',
            detail: 'After the sale closes, calculate gross sales minus our commission. Fill out the settlement sheet. Send payment to the client within 10 business days.',
            tip: 'Settlement sheet template is in Google Drive under JSG / Settlements.',
          },
          {
            title: 'Fulfill orders',
            detail: 'Ship sold items to buyers. Coordinate local pickup for large items. All tracking numbers logged in the listing platform.',
            warning: 'Never ship an item without a confirmed payment and cleared funds.',
          },
        ],
      },
      {
        id: 'scenarios',
        icon: '🔀',
        title: 'Common Situations',
        type: 'scenarios',
        scenarios: [
          {
            if: 'Client asks when they\'ll get paid',
            then: 'Settlement happens within 10 business days of the sale closing. Check the settlement sheet in Google Drive to give them a specific date.',
          },
          {
            if: 'An item sold but we can\'t locate it',
            then: 'Search the cataloging photos from intake. Check all storage areas in the property. If genuinely missing, contact David before contacting the buyer.',
            who: 'Vinnie handles search first; David makes the call on buyer communication',
          },
          {
            if: 'Buyer reports item arrived damaged',
            then: 'Ask the buyer to send photos of the damage and the packaging. Document everything. File an insurance claim if applicable. Do not issue refunds unilaterally — check with David.',
          },
          {
            if: 'Someone asks to buy an item privately before the auction',
            then: 'Take the inquiry and pass it to David. We do not pull items from active auction without his approval.',
          },
          {
            if: 'Client is unhappy with their settlement amount',
            then: 'Show them the settlement sheet with gross sales, fees, and net amount. If they dispute a specific item\'s price, explain the comp research. Escalate to David if they remain unhappy.',
          },
          {
            if: 'An item doesn\'t sell in the auction',
            then: 'Relist at a lower price, or move to a different platform. Check with David on whether to hold, relist, or donate.',
          },
        ],
      },
    ],
    technical: {
      stack: ['DOA (Direct of Auction)', 'LiveAuctioneers', 'eBay', 'Mercari', 'Poshmark', 'Etsy', 'Google Drive'],
      integrations: ['VZT (AI listing tool — internal)', 'Claude in Chrome for DOA/LiveAuctioneers admin automation', 'Supabase (data logging)'],
      how_it_works:
        'JSG uses VZT to process item photos into priced listings. Listings are distributed across platforms manually or through Claude-assisted browser automation for platforms that lack APIs. All settlement data is tracked in Google Drive spreadsheets.',
      owner: 'David (strategy) + Vinnie (ops)',
      notes: 'This is the primary revenue generator for the whole portfolio. Protect it. Do not experiment on live listings without a backup plan.',
    },
  },

  {
    slug: 'vzt',
    name: 'VZT',
    tagline: 'AI resale intelligence — photo in, listing out.',
    description:
      'VZT turns a photo of any secondhand item into a priced, ready-to-copy marketplace listing in under 2 minutes. What used to take 20–30 minutes of research per item now takes two. Currently used internally for JSG; being rebuilt as a multi-tenant SaaS for resellers everywhere.',
    tier: 1,
    stage: 'build',
    emoji: '🔍',
    revenue_model: 'Monthly subscription per workspace (SaaS) — pre-revenue, launching soon',
    chapters: [
      {
        id: 'what',
        icon: '🔍',
        title: 'What Is VZT?',
        type: 'text',
        content:
          'VZT is an AI tool that solves one specific problem: resellers spend too much time researching what an item is worth and writing the listing. With VZT, you upload a photo. The AI identifies the item, checks what similar ones have sold for, and gives you a finished listing title, description, and price recommendation.\n\nRight now VZT is used exclusively by JSG. The next version (v2) is a multi-tenant SaaS — any reseller, consignment shop, thrift store, or auction house can create a workspace and use it as a paid subscriber.',
      },
      {
        id: 'roles',
        icon: '👥',
        title: 'Who Uses It',
        type: 'roles',
        roles: [
          {
            who: 'David',
            does: 'Sole coder and maintainer. All technical decisions. No one else touches the code.',
            level: 'full',
          },
          {
            who: 'Vinnie',
            does: 'Primary day-to-day user for JSG processing. Uploads photos, reviews AI output, copies listings to sale platforms.',
            level: 'full',
          },
          {
            who: 'Future tenants (resellers)',
            does: 'Sign up, create a workspace, upload items, copy listings. Same workflow as Vinnie.',
            level: 'full',
          },
        ],
      },
      {
        id: 'how-to',
        icon: '📸',
        title: 'How to Use VZT',
        type: 'steps',
        steps: [
          {
            title: 'Log in to VZT',
            detail: 'Open the VZT URL in your browser. Sign in with your account.',
          },
          {
            title: 'Start a new item',
            detail: 'Click "New Item." Upload one or more photos of the item from different angles. Clear photos give better results — good lighting, plain background if possible.',
          },
          {
            title: 'Let the AI analyze',
            detail: 'VZT runs the photos through Google Gemini Vision to identify the item, then searches comparable sold prices on eBay and other platforms. This takes 15–45 seconds.',
          },
          {
            title: 'Review the results',
            detail: 'You\'ll see: item name, condition grade, suggested price, platform recommendation, and a ready-to-copy listing title + description. Check that the identification is correct before using the output.',
            tip: 'Click "View Comparables" to see the actual sold listings that informed the price. If any look irrelevant, note it.',
          },
          {
            title: 'Make adjustments if needed',
            detail: 'If the AI got the item name wrong, click "Correct Identification" and type the right name. Click "Re-analyze" to regenerate with the correction.',
          },
          {
            title: 'Copy and use the listing',
            detail: 'Copy the title and description to whatever platform you\'re listing on (eBay, DOA, etc.). Use the suggested price as your starting point — you can adjust based on your judgment.',
          },
        ],
      },
      {
        id: 'scenarios',
        icon: '🔀',
        title: 'Common Situations',
        type: 'scenarios',
        scenarios: [
          {
            if: 'AI identified the item incorrectly',
            then: 'Click "Correct Identification," type the actual item name and any relevant details (brand, model, era). Click Re-analyze. The AI will regenerate based on your correction.',
          },
          {
            if: 'The price seems too high or too low',
            then: 'Click "View Comparables" to see the actual sold listings. If the comps don\'t match the item (wrong condition, different model), adjust the price manually based on your judgment.',
          },
          {
            if: 'Need to process a large batch of items quickly',
            then: 'Use batch upload — upload multiple photos at once and let VZT process them in the background. Review results when they\'re ready rather than waiting for each one.',
          },
          {
            if: 'App is slow or not loading',
            then: 'Try a hard refresh (Ctrl+Shift+R). If still broken, contact David immediately. Do not attempt to troubleshoot the backend.',
          },
          {
            if: 'A listing needs to match a specific platform\'s format',
            then: 'VZT generates a generic listing. When pasting to a specific platform, adjust the character limits and category fields manually. The content (title, description, price) stays the same.',
          },
        ],
      },
    ],
    technical: {
      stack: ['Next.js', 'Supabase (Postgres + Auth + Storage)', 'Google Gemini Vision API', 'Vercel'],
      integrations: ['eBay API (comparable sales data)', 'Gemini Vision API (item identification)', 'Supabase Storage (image uploads)'],
      how_it_works:
        'User uploads a photo → Supabase Storage saves it → Gemini Vision identifies the item → backend queries eBay sold listings API for comparable prices → Claude generates a formatted listing from item data + comps → result returned to UI. Multi-tenant architecture means each workspace is isolated with its own data context.',
      owner: 'David (sole maintainer — protected codebase)',
      notes: 'Tier 1 protected project. Changes require staging environment testing first. No one but David commits code to this repo. See CLAUDE.md for the full protection protocol.',
    },
  },

  {
    slug: 'reelflow',
    name: 'REELFLOW',
    tagline: 'AI video engine for small businesses — describe it, get a reel.',
    description:
      'REELFLOW turns a text description into a short-form social media video. Tell it what you want, it writes the script and generates the video. For businesses that need a steady stream of content without hiring a videographer.',
    tier: 1,
    stage: 'build',
    emoji: '🎬',
    revenue_model: 'Monthly subscription per workspace — pre-revenue',
    chapters: [
      {
        id: 'what',
        icon: '🎬',
        title: 'What Is REELFLOW?',
        type: 'text',
        content:
          'REELFLOW is an AI video factory. You describe what you want — a 30-second promo for a sale, a product showcase, a how-it-works explainer — and REELFLOW writes the script and generates the video automatically. The output is a short-form video (15–60 seconds) ready for Instagram Reels, TikTok, or YouTube Shorts.\n\nThe target customer is a small business owner who knows they need social video content but has no time, no budget for a videographer, and no editing skills. REELFLOW removes all three barriers.',
      },
      {
        id: 'roles',
        icon: '👥',
        title: 'Who Uses It',
        type: 'roles',
        roles: [
          {
            who: 'David',
            does: 'Builds and maintains the platform.',
            level: 'full',
          },
          {
            who: 'Small business owners (future users)',
            does: 'Log in, describe the video they want, generate it, download or post.',
            level: 'full',
          },
          {
            who: 'JSG (internal use)',
            does: 'Generate promotional videos for upcoming auctions and estate sales.',
            level: 'full',
          },
        ],
      },
      {
        id: 'how-to',
        icon: '🎥',
        title: 'How to Create a Reel',
        type: 'steps',
        steps: [
          {
            title: 'Log in to REELFLOW',
            detail: 'Sign in with your account. You\'ll see your workspace with past reels and a "New Reel" button.',
          },
          {
            title: 'Describe what you want',
            detail: 'Click "New Reel" and type a description of the video. Be specific: length, tone, subject, call to action. Example: "30-second ad for our spring furniture sale, casual upbeat tone, ending with our phone number."',
            tip: 'The more detail you give, the better the output. Include tone (casual, professional, urgent), target audience, and the key message.',
          },
          {
            title: 'Review and edit the script',
            detail: 'AI generates a script first. Read through it. You can edit it directly or ask REELFLOW to adjust ("make it funnier" / "shorter" / "more urgent").',
          },
          {
            title: 'Generate the video',
            detail: 'Click "Generate Video." REELFLOW sends the script to the video AI (Google Veo 3). This takes 1–3 minutes.',
          },
          {
            title: 'Preview and download',
            detail: 'Watch the preview. If you\'re happy, download the video file. If not, adjust the script or visual direction and regenerate.',
          },
          {
            title: 'Post to social media',
            detail: 'Download the video and post to Instagram Reels, TikTok, YouTube Shorts, or Facebook. Future versions will have direct publishing built in.',
          },
        ],
      },
      {
        id: 'scenarios',
        icon: '🔀',
        title: 'Common Situations',
        type: 'scenarios',
        scenarios: [
          {
            if: 'The generated video looks off or wrong',
            then: 'Regenerate with more specific visual instructions. Add direction like: "show products on a clean white background" or "outdoor footage, bright daylight." The AI responds to visual context in the prompt.',
          },
          {
            if: 'Need the same video style consistently across multiple videos',
            then: 'Set up templates in your workspace settings. Save brand colors, tone of voice, logo usage, and a "style example." All new reels from that workspace will pull from the template.',
          },
          {
            if: 'A client needs a specific branded look',
            then: 'Create a separate workspace for that client. Add their brand guidelines (colors, fonts, logo, tone). All videos generated in that workspace match their brand.',
          },
          {
            if: 'The script AI wrote doesn\'t sound like the business',
            then: 'Edit the script manually before generating. The video AI uses the script as written — so if the script sounds right, the video will too.',
          },
        ],
      },
    ],
    technical: {
      stack: ['Next.js', 'Supabase', 'Google Veo 3 (video generation)', 'Vercel'],
      integrations: ['Google Veo 3 API', 'Supabase Storage (video files)', 'Claude (script generation)'],
      how_it_works:
        'User submits a prompt → Claude generates a video script → script is sent to Veo 3 API → Veo 3 renders a short-form video → video stored in Supabase Storage → delivered back to the user. Multi-tenant: each business has an isolated workspace.',
      owner: 'David',
      notes: 'Being built alongside VZT multi-tenant transition. Both share the same SaaS architecture pattern.',
    },
  },

  // ─── Tier 2: Active Builds ──────────────────────────────────────

  {
    slug: 'deal-finder',
    name: 'Deal Finder + Garage Sale Hunter',
    tagline: 'Two tools for resellers: find underpriced items before anyone else does.',
    description:
      'Deal Finder watches online marketplaces for items listed below their resale value and alerts you instantly. Garage Sale Hunter finds estate and garage sales near you worth attending, ranked by your buy list. Two tools, one mission: never miss a flip.',
    tier: 2,
    stage: 'build',
    emoji: '🔎',
    revenue_model: 'Monthly subscription per user — pre-revenue',
    chapters: [
      {
        id: 'what',
        icon: '🔎',
        title: 'What Are These Tools?',
        type: 'text',
        content:
          'There are two tools here that share the same audience (resellers and flippers) and complement each other.\n\n**Deal Finder** monitors eBay, Facebook Marketplace, Craigslist, and other platforms continuously. When it finds an item listed below what it\'s worth on the open market, it notifies you. You act fast — buy it, sell it for more.\n\n**Garage Sale Hunter** finds garage sales and estate sales happening near you this weekend. It scores each sale based on your buy list, so instead of driving to every sale in a 20-mile radius, you know which three are worth your time.',
      },
      {
        id: 'roles',
        icon: '👥',
        title: 'Who Uses It',
        type: 'roles',
        roles: [
          {
            who: 'David',
            does: 'Builds and maintains both tools.',
            level: 'full',
          },
          {
            who: 'Resellers and flippers (users)',
            does: 'Set up their buy lists, receive deal alerts, plan sale routes.',
            level: 'full',
          },
        ],
      },
      {
        id: 'deal-finder-steps',
        icon: '📡',
        title: 'Using Deal Finder',
        type: 'steps',
        steps: [
          {
            title: 'Set up your buy list',
            detail: 'Tell Deal Finder what you\'re looking for: categories (vintage electronics, tools, sneakers), specific items, brands, and your maximum buy price. The more specific, the fewer irrelevant alerts you get.',
          },
          {
            title: 'Let it run',
            detail: 'Deal Finder checks marketplaces multiple times per day. You don\'t have to do anything — it works in the background.',
          },
          {
            title: 'Get notified on a deal',
            detail: 'When something matches your criteria and is priced below market, you get a notification (email or push). The alert shows: item title, asking price, comparable sold prices, and a confidence score.',
          },
          {
            title: 'Decide and act',
            detail: 'Review the deal. Check the comparables. If it makes sense, go buy it — link takes you directly to the listing. Good deals sell within minutes, so move fast.',
          },
        ],
      },
      {
        id: 'garage-sale-steps',
        icon: '🗺️',
        title: 'Using Garage Sale Hunter',
        type: 'steps',
        steps: [
          {
            title: 'Enter your location and range',
            detail: 'Set your zip code and how far you\'re willing to drive. Garage Sale Hunter pulls every advertised sale in that radius.',
          },
          {
            title: 'See your ranked list',
            detail: 'Sales are scored based on how well their advertised items match your buy list. High-score sales get flagged first.',
          },
          {
            title: 'Plan your route',
            detail: 'Pick which sales to attend. Garage Sale Hunter builds a driving route optimized for time, sorted by score so you hit the best ones early.',
          },
          {
            title: 'Go make money',
            detail: 'Arrive early — the best items go first. Check off visited sales in the app.',
          },
        ],
      },
      {
        id: 'scenarios',
        icon: '🔀',
        title: 'Common Situations',
        type: 'scenarios',
        scenarios: [
          {
            if: 'Getting too many irrelevant alerts',
            then: 'Tighten your buy list. Add more specific terms, set a lower max price, or exclude categories you don\'t actually flip.',
          },
          {
            if: 'Missing deals because alerts are slow',
            then: 'Check your notification settings — make sure push notifications are enabled, not just email.',
          },
          {
            if: 'A sale shows as high-score but the items don\'t match when you arrive',
            then: 'Sellers don\'t always list everything in their ads. Rate the sale after visiting so the algorithm learns. This improves future scoring.',
          },
        ],
      },
    ],
    technical: {
      stack: ['Next.js', 'Supabase', 'Vercel'],
      integrations: ['eBay API', 'Facebook Marketplace scraping', 'Craigslist scraping', 'Garage sale listing aggregators'],
      how_it_works:
        'Deal Finder runs a background job on a schedule, scraping configured sources for new listings. Each listing is scored against user buy lists using AI classification (Haiku-tier — cheap, fast). Matches above threshold trigger notifications. Garage Sale Hunter scrapes sale aggregator sites and scores each sale against the user\'s buy list.',
      owner: 'David',
      notes: 'Two products, one codebase. User acquisition is the primary challenge post-build.',
    },
  },

  {
    slug: 'marblism',
    name: 'Marblism Agency',
    tagline: 'AI-assisted websites and SEO for businesses that want to be found.',
    description:
      'Marblism builds websites for small businesses and optimizes them to rank — in Google, and in AI search engines like ChatGPT and Perplexity. Monthly retainer model. AI does the heavy lifting; humans do the strategy and relationship work.',
    tier: 2,
    stage: 'active',
    emoji: '🌐',
    revenue_model: 'Setup fee + monthly retainer per client',
    chapters: [
      {
        id: 'what',
        icon: '🌐',
        title: 'What Is Marblism?',
        type: 'text',
        content:
          'Marblism is a web design and SEO/GEO agency. We build websites for businesses and then optimize those sites so they show up when potential customers search online.\n\n"SEO" (Search Engine Optimization) means ranking in Google. "GEO" (Generative Engine Optimization) is the newer version — making sure your business shows up when someone asks ChatGPT, Perplexity, or another AI assistant for a recommendation.\n\nAI does a significant portion of the site build and content generation. The operator provides strategy and client management. The result: faster delivery, higher margins, consistent output.',
      },
      {
        id: 'roles',
        icon: '👥',
        title: 'Who Does What',
        type: 'roles',
        roles: [
          {
            who: 'David',
            does: 'Client acquisition, project oversight, pricing strategy, quality review on client-facing copy',
            level: 'full',
          },
          {
            who: 'AI systems',
            does: 'Site structure generation, content drafts, SEO meta, schema markup',
            level: 'limited',
          },
          {
            who: 'Clients',
            does: 'Discovery call, brand input, review and approve deliverables, pay retainer',
            level: 'limited',
          },
        ],
      },
      {
        id: 'client-process',
        icon: '🤝',
        title: 'The Client Process',
        type: 'steps',
        steps: [
          {
            title: 'Discovery call',
            detail: 'Understand the business: what they sell, who their customers are, what keywords matter, what competitors they lose to. 30–45 minutes.',
          },
          {
            title: 'Site build',
            detail: 'AI generates initial site structure and content. Human review ensures it sounds like the client\'s business, not a template. Client reviews a staging link before launch.',
            tip: 'All client-facing copy must pass a human voice check. It should sound like a real business, not AI-generated.',
          },
          {
            title: 'SEO and GEO setup',
            detail: 'Keyword research, on-page optimization, metadata, structured data (schema.org markup so AI search engines can extract and cite the business information accurately).',
          },
          {
            title: 'Launch',
            detail: 'Site goes live on client\'s domain. Confirm DNS propagation, test all pages, verify SEO metadata is indexed.',
          },
          {
            title: 'Monthly maintenance and reporting',
            detail: 'Update content, respond to ranking changes, send a monthly report showing traffic and keyword movement. Keep the relationship active.',
          },
        ],
      },
      {
        id: 'scenarios',
        icon: '🔀',
        title: 'Common Situations',
        type: 'scenarios',
        scenarios: [
          {
            if: 'Client asks why they\'re not ranking yet',
            then: 'New sites take 3–6 months for meaningful Google movement. Show them the trajectory (impressions growing even if clicks haven\'t moved). GEO can be faster — AI engines pick up fresh, authoritative content.',
          },
          {
            if: 'Client asks why they\'re not in ChatGPT results',
            then: 'Explain that AI search citation depends on authoritative content, structured data, and brand mentions across the web. Check their schema markup. Make sure their business is listed consistently on Google Business Profile, Yelp, etc.',
          },
          {
            if: 'Client requests site changes',
            then: 'Log the request. Small changes (copy edits, new page) within 48 hours for retainer clients. Structural redesigns go through a mini discovery to scope properly.',
          },
          {
            if: 'Client wants to pause their retainer',
            then: 'Find out why. If they\'re not seeing results, show the data. If it\'s a budget issue, discuss a lighter tier. Pause options exist — they retain the site; we pause the SEO work.',
          },
        ],
      },
    ],
    technical: {
      stack: ['Next.js', 'Marblism platform', 'Vercel', 'Supabase'],
      integrations: ['Claude (content generation — Sonnet tier)', 'Google Search Console', 'Google Analytics', 'Google Business Profile API'],
      how_it_works:
        'Client onboarding captures business info and brand voice. Claude generates initial site content and SEO copy based on the brief. Marblism platform handles site structure and deployment. Monthly SEO reports pull from Google Search Console API.',
      owner: 'David',
      notes: 'Client-facing copy always gets a human voice review before delivery. AI writes the draft; human approves the voice.',
    },
  },

  {
    slug: 'auction-house',
    name: 'Auction House US Scale-Out',
    tagline: 'Replicating the JSG model into new US markets.',
    description:
      'The Denver auction house model works. The question is whether it can be replicated — either through direct expansion or a partner/franchise model. This project defines the playbook and identifies which markets to move into next.',
    tier: 2,
    stage: 'spec',
    emoji: '🏛️',
    revenue_model: 'Revenue share with local operators, or direct JSG expansion in new markets',
    chapters: [
      {
        id: 'what',
        icon: '🏛️',
        title: 'What Is This Project?',
        type: 'text',
        content:
          'JSG runs estate liquidations in Denver. The model is proven: take a property, catalog and price items using AI, list across platforms, run the auction, settle with the client. It makes money.\n\nThe question this project answers is: can that same model be exported to Chicago, Phoenix, Dallas, or any other major US metro? And if so, what\'s the fastest, least risky way to do it — direct expansion, or finding a local operator partner who handles on-the-ground execution while we provide the platform and playbook?\n\nThis is a scaling exercise, not a build. The tech exists. The process exists. We\'re figuring out the replication.',
      },
      {
        id: 'roles',
        icon: '👥',
        title: 'Who\'s Involved',
        type: 'roles',
        roles: [
          {
            who: 'David',
            does: 'Market selection criteria, partner evaluation, platform setup for new markets, financial model',
            level: 'full',
          },
          {
            who: 'Vinnie',
            does: 'Template for execution — the Denver model is his playbook',
            level: 'limited',
          },
          {
            who: 'Future city partners',
            does: 'On-the-ground execution in their market: client intake, cataloging, fulfillment',
            level: 'limited',
          },
        ],
      },
      {
        id: 'expansion-steps',
        icon: '🗺️',
        title: 'The Expansion Playbook',
        type: 'steps',
        steps: [
          {
            title: 'Market research',
            detail: 'Evaluate target cities for: estate liquidation demand (aging population, estate size), competition (are there existing players? how good?), operational complexity (shipping logistics, local regulations).',
          },
          {
            title: 'Define the model for that market',
            detail: 'Direct expansion (JSG team moves in) vs. partner model (local operator uses our platform and playbook, we take a cut). Partner model is lower risk and faster to test.',
          },
          {
            title: 'Platform setup',
            detail: 'Configure DOA and LiveAuctioneers accounts for the new market. Set up VZT workspace for the new location. Test end-to-end with a sample estate.',
          },
          {
            title: 'First auction',
            detail: 'Run a test auction in the new market. Learn what\'s different about buyer behavior, logistics, and client expectations in that city.',
          },
          {
            title: 'Refine the playbook',
            detail: 'Document what changed, what worked, what didn\'t. Update the partner playbook. Repeat in the next city.',
          },
        ],
      },
    ],
    technical: {
      stack: ['DOA', 'LiveAuctioneers', 'VZT (internal AI listing tool)', 'Existing JSG infrastructure'],
      integrations: [],
      how_it_works:
        'Same tech stack as Denver JSG operations, replicated per market. Each new market gets its own DOA/LiveAuctioneers seller account and a VZT workspace.',
      owner: 'David',
      notes: 'This is currently in spec/planning phase. Denver model is the validation. No new tech to build — this is operational expansion.',
    },
  },

  // ─── Tier 3: Personal / Family ─────────────────────────────────

  {
    slug: 'college-climb',
    name: 'College Climb',
    tagline: 'AI college counselor in your pocket — free, personalized, and actually useful.',
    description:
      'College Climb helps high schoolers figure out where to apply, what scholarships they qualify for, and how to write their application essays. Like having a private college counselor, without the $5,000 price tag.',
    tier: 3,
    stage: 'build',
    emoji: '🎓',
    revenue_model: 'Freemium → premium features (TBD post-validation)',
    chapters: [
      {
        id: 'what',
        icon: '🎓',
        title: 'What Is College Climb?',
        type: 'text',
        content:
          'College Climb is an AI-powered college planning app for high school students. The problem it solves: getting into a good college is a complicated, stressful process — and professional guidance costs thousands of dollars that most families can\'t afford.\n\nCollege Climb handles the four biggest pain points:\n1. **Where should I apply?** — Personalized college list based on your stats and fit\n2. **Can I afford it?** — Scholarship matching based on your profile\n3. **How do I write my essays?** — AI-assisted drafting with your real voice\n4. **Am I staying on track?** — Deadline tracking and application status\n\nPrimary user: high school students in grades 9–12 and their parents.',
      },
      {
        id: 'roles',
        icon: '👥',
        title: 'Who Uses It',
        type: 'roles',
        roles: [
          {
            who: 'David',
            does: 'Builds and maintains the app.',
            level: 'full',
          },
          {
            who: 'JJ (primary test user)',
            does: 'First real user — runs his actual college search through the app to validate it works for a real student.',
            level: 'full',
          },
          {
            who: 'Students (grades 9–12)',
            does: 'Create profile, get college list, find scholarships, write essays, track applications.',
            level: 'full',
          },
          {
            who: 'Parents',
            does: 'Review the student\'s plan, understand costs, help with essay feedback.',
            level: 'view-only',
          },
        ],
      },
      {
        id: 'student-steps',
        icon: '📚',
        title: 'Using College Climb (Student View)',
        type: 'steps',
        steps: [
          {
            title: 'Create your profile',
            detail: 'Enter your GPA, test scores (SAT/ACT if you have them), extracurriculars, intended major, career interests, and family budget range for tuition.',
            tip: 'Be honest with your numbers. College Climb gives better recommendations when your profile is accurate — not what you wish your GPA was.',
          },
          {
            title: 'Get your college list',
            detail: 'College Climb generates a personalized list sorted into three tiers: likely (strong chance of acceptance), target (realistic), and reach (ambitious but possible). Each school includes: acceptance rate for your profile, average aid, campus culture summary.',
          },
          {
            title: 'Find scholarships',
            detail: 'Go to the Scholarships tab. College Climb shows scholarships you\'re likely to qualify for based on your profile — local, national, major-specific, and community-based. Each one shows eligibility criteria, deadline, and a direct link to apply.',
          },
          {
            title: 'Write your essays',
            detail: 'In the Essays tab, choose a prompt. Describe what you want to say in plain language (don\'t try to write an essay yet — just tell the AI the idea). It will draft something. Then edit it until it sounds exactly like you.',
            warning: 'College essays need to sound like you, not like AI. Always rewrite in your own voice after the AI draft.',
          },
          {
            title: 'Track your applications',
            detail: 'Use the Tracker to set deadlines and mark each school\'s requirements (common app, supplements, recommendations). Get reminder notifications as deadlines approach.',
          },
        ],
      },
      {
        id: 'scenarios',
        icon: '🔀',
        title: 'Common Situations',
        type: 'scenarios',
        scenarios: [
          {
            if: 'Student wants to see different or more schools',
            then: 'Expand the fit range in settings, or toggle "Show reach schools" to see ambitious options. Students can also manually add any school to their list.',
          },
          {
            if: 'Parent asks about what the student will actually pay',
            then: 'Each school\'s profile has a net price calculator. It estimates what the family is likely to pay after aid, based on the financial info in the profile.',
          },
          {
            if: 'The essay AI output sounds too stiff or formal',
            then: 'Prompt it: "Write this the way a 17-year-old would actually say it." Edit line-by-line after to add your real voice. The goal is authenticity, not polish.',
          },
          {
            if: 'A school\'s deadline or requirements look wrong in the app',
            then: 'College data can be a semester behind. Always verify deadlines and requirements on the school\'s official admissions website before submitting.',
          },
          {
            if: 'Student is already a senior and needs to apply in the next few weeks',
            then: 'Flag the profile as "urgent" in settings. College Climb will prioritize showing Early Decision and Regular Decision deadlines for the current cycle.',
          },
        ],
      },
    ],
    technical: {
      stack: ['Next.js', 'Supabase', 'Vercel'],
      integrations: ['Claude API (essays and planning — Sonnet tier)', 'College and scholarship data feeds'],
      how_it_works:
        'Student profile data is matched against a college and scholarship database to generate personalized recommendations. Essay AI uses Claude with context from the student\'s profile to generate drafts matching their stated idea and voice. Application tracker uses Supabase for deadline storage and reminder scheduling.',
      owner: 'David (builder) — JJ is primary validator',
      notes: 'App is unvalidated as of mid-2026. Phase 1: JJ runs his real college search through it. Phase 2: 5–10 beta students. Do not ship to public until Phase 2 feedback is incorporated.',
    },
  },

  {
    slug: 'kdp',
    name: 'KDP Publishing Pipeline',
    tagline: 'AI-assisted book publishing on Amazon — research, write, design, publish.',
    description:
      'An end-to-end system for publishing books on Amazon Kindle Direct Publishing. The AI handles niche research, writing assistance, and cover design. Nicole runs the business; David maintains the tools.',
    tier: 3,
    stage: 'build',
    emoji: '📚',
    revenue_model: 'Amazon KDP royalties (35% or 70% depending on price tier)',
    chapters: [
      {
        id: 'what',
        icon: '📚',
        title: 'What Is the KDP Pipeline?',
        type: 'text',
        content:
          'Self-publishing on Amazon (KDP — Kindle Direct Publishing) is a legitimate passive income stream if you pick the right niches. The problem is that finding what to write, writing it, designing the cover, and getting it live requires either a lot of skill or a lot of time.\n\nThis pipeline automates the hard parts: AI identifies profitable niches with low competition, assists with outlining and drafting, generates cover options, and formats the final document for upload. Nicole makes the editorial and business decisions; the AI accelerates execution.',
      },
      {
        id: 'roles',
        icon: '👥',
        title: 'Who Does What',
        type: 'roles',
        roles: [
          {
            who: 'Nicole',
            does: 'Runs the business. Picks niches, reviews AI drafts, manages the publishing schedule, tracks sales.',
            level: 'full',
          },
          {
            who: 'David',
            does: 'Maintains the technical tools. Not involved in day-to-day publishing decisions.',
            level: 'limited',
          },
          {
            who: 'Buyers (Amazon readers)',
            does: 'Purchase books through Amazon.',
            level: 'view-only',
          },
        ],
      },
      {
        id: 'publishing-steps',
        icon: '🖊️',
        title: 'Publishing a Book, Step by Step',
        type: 'steps',
        steps: [
          {
            title: 'Research the niche',
            detail: 'Use the niche research tool to find categories with solid demand and weak competition. Look at: search volume for relevant keywords, existing book sales (are the top books selling?), how many reviews top sellers have (lower reviews = easier to compete).',
            tip: 'Validate before writing. A well-researched niche saves weeks of wasted effort.',
          },
          {
            title: 'Outline the book',
            detail: 'Pick a working title and input the niche. AI generates a chapter outline. Review and edit it — make sure the structure actually serves the reader, not just fills pages.',
          },
          {
            title: 'Write with AI assistance',
            detail: 'Work chapter by chapter. Input the chapter topic and key points; AI drafts the section. Nicole reads, edits, and adds her voice and real-world knowledge. The final text should not read like AI output.',
          },
          {
            title: 'Generate the cover',
            detail: 'Use the cover design tool (Nano Banana 2 AI). Input title, genre, and visual direction. Generate several options. Pick the one that looks most like the top sellers in the category.',
            tip: 'Your cover is your ad. Compare it to the top 5 books in your category on Amazon — yours needs to look like it belongs there.',
          },
          {
            title: 'Format and upload',
            detail: 'The pipeline formats the manuscript to KDP specs (correct margins, headers, table of contents). Upload the formatted file and cover to KDP. Set price and royalty structure.',
          },
          {
            title: 'Set pricing and go live',
            detail: 'Books priced $2.99–$9.99 earn 70% royalties. Below or above that range, Amazon pays only 35%. Set your price in the sweet spot unless there\'s a specific reason not to.',
          },
          {
            title: 'Track and iterate',
            detail: 'Monitor the KDP dashboard daily for the first two weeks. Check sales, reviews, and keyword ranking. If a book isn\'t moving, experiment with the title, description, or price.',
          },
        ],
      },
      {
        id: 'scenarios',
        icon: '🔀',
        title: 'Common Situations',
        type: 'scenarios',
        scenarios: [
          {
            if: 'A book isn\'t selling after launch',
            then: 'Check the keyword targeting in the title, subtitle, and description. Run a price experiment (try $0.99 for a week to get downloads and reviews). Look at what the #1 book in that category is doing differently.',
          },
          {
            if: 'A negative review comes in',
            then: 'Don\'t respond emotionally. If the feedback is legitimate, note it for the next edition. If it\'s a one-star with no explanation, monitor for patterns. A few bad reviews are normal and don\'t kill a book.',
          },
          {
            if: 'Want to publish in a niche Nicole knows nothing about',
            then: 'Don\'t skip niche validation. Confirm there\'s real demand (people searching and buying) before writing. AI can write on any topic — but the market has to exist.',
          },
          {
            if: 'Amazon rejects the book at upload',
            then: 'Read the rejection reason carefully. Common issues: formatting errors, cover size requirements, or content flags. Check KDP content guidelines. Fix the specific issue and reupload.',
          },
        ],
      },
    ],
    technical: {
      stack: ['Amazon KDP platform', 'Nano Banana 2 (cover generation)', 'Claude (writing assistance — Sonnet tier)'],
      integrations: ['KDP API (publishing workflow)', 'Amazon keyword research tools'],
      how_it_works:
        'Niche research tool scrapes and scores Amazon categories by demand/competition ratio. Claude assists with outlines and chapter drafts. Nano Banana 2 generates cover image options. KDP upload is manual after formatting.',
      owner: 'Nicole (business owner) — David (technical support)',
      notes: 'Nicole is the operator of this business. David\'s role is limited to maintaining the tools. Day-to-day publishing decisions are hers.',
    },
  },

  {
    slug: 'ai-receptionist',
    name: 'AI Receptionist',
    tagline: 'AI phone and text receptionist for small businesses — always available, never missed.',
    description:
      'An AI system that handles incoming calls and texts for small businesses. Answers questions, books appointments, and escalates complex issues to a human. JJ\'s business to build and run.',
    tier: 3,
    stage: 'spec',
    emoji: '📞',
    revenue_model: 'Monthly subscription per business — pre-revenue',
    chapters: [
      {
        id: 'what',
        icon: '📞',
        title: 'What Is This?',
        type: 'text',
        content:
          'Small business owners miss calls. A missed call is often a missed sale — the customer just calls the next business in the search results.\n\nAI Receptionist puts an AI on the phone for those businesses. It answers calls, responds to texts, handles the most common questions, and books appointments. If something is too complex or the caller is clearly frustrated, it escalates immediately to the real human.\n\nThe business owner gets a log of every call and text — what was asked, what the AI said, what happened. They can review it on their phone in minutes. JJ is the lead for this business.',
      },
      {
        id: 'roles',
        icon: '👥',
        title: 'Who\'s Involved',
        type: 'roles',
        roles: [
          {
            who: 'JJ',
            does: 'Owns and runs the business. Client acquisition, onboarding, support, pricing.',
            level: 'full',
          },
          {
            who: 'David',
            does: 'Builds and maintains the infrastructure. Available for technical support.',
            level: 'limited',
          },
          {
            who: 'Business clients',
            does: 'Connect their phone number, set up their FAQs and hours, review call logs.',
            level: 'full',
          },
          {
            who: 'Their callers',
            does: 'Talk to the AI when calling the business. They may not know it\'s AI.',
            level: 'view-only',
          },
        ],
      },
      {
        id: 'client-onboarding',
        icon: '🔧',
        title: 'Setting Up a New Client',
        type: 'steps',
        steps: [
          {
            title: 'Intake call with the client',
            detail: 'Learn their business: what services they offer, their hours, their most common caller questions, how they want calls handled (book immediately, take a message, transfer, etc.).',
          },
          {
            title: 'Connect their phone number',
            detail: 'Set up a Twilio forwarding number for the client. Calls to their business phone are forwarded to the AI when not answered (or always, depending on their plan).',
          },
          {
            title: 'Train the AI',
            detail: 'Input the client\'s business info into their settings: services, pricing, hours, FAQs, escalation triggers ("if caller is angry," "if they ask for a specific person," etc.).',
          },
          {
            title: 'Run test calls',
            detail: 'Call the number yourself. Test common scenarios. Test edge cases. Make sure the AI handles them correctly before telling the client it\'s live.',
          },
          {
            title: 'Go live and monitor',
            detail: 'Switch the number live. Review the call logs daily for the first week. Catch anything the AI is handling badly and fix the training.',
          },
        ],
      },
      {
        id: 'scenarios',
        icon: '🔀',
        title: 'Common Situations',
        type: 'scenarios',
        scenarios: [
          {
            if: 'AI gave a caller the wrong hours or wrong information',
            then: 'Log in to the client\'s settings and update the incorrect information. Run a test call to confirm the fix. Notify the client that the correction was made.',
            who: 'JJ (or David if technical)',
          },
          {
            if: 'AI escalated too many calls to the human',
            then: 'Review the call transcripts to see what triggered escalation. Add those topics explicitly to the trained FAQ so the AI handles them directly next time.',
          },
          {
            if: 'Client wants to add appointment booking',
            then: 'Connect to their Google Calendar (or whatever booking tool they use). Configure available time blocks. Test the booking flow with a real test appointment.',
          },
          {
            if: 'Client is unhappy and considering canceling',
            then: 'Get on a call. Find out what broke down. If it\'s a training issue, fix it in front of them. If they\'re churning anyway, document why — it\'s valuable feedback for the product.',
            who: 'JJ handles',
          },
          {
            if: 'A caller complains they didn\'t know they were talking to AI',
            then: 'Check the jurisdiction\'s disclosure requirements — some states require AI callers to identify themselves. If disclosure is needed, update the opening greeting for that client.',
            who: 'David + JJ evaluate legal requirement',
          },
        ],
      },
    ],
    technical: {
      stack: ['Next.js', 'Supabase', 'Twilio (calls + SMS)', 'Vercel'],
      integrations: ['Twilio API (phone infrastructure)', 'Google Calendar API (appointment booking)', 'Claude (conversation AI — Haiku for simple FAQs, Sonnet for complex)'],
      how_it_works:
        'Incoming call → Twilio routes to the AI system → Claude handles the conversation using the client\'s trained context → appointment booking calls Google Calendar API if needed → call summary written to Supabase → client notified via SMS with call summary.',
      owner: 'JJ (business) — David (infrastructure)',
      notes: 'JJ is the operator of this business. David\'s role is building and maintaining the platform. Client-facing decisions are JJ\'s to make.',
    },
  },

  // ─── Mission Control itself ─────────────────────────────────────

  {
    slug: 'mission-control-os',
    name: 'Mission Control',
    tagline: 'The operating system for the whole portfolio.',
    description:
      'One dashboard to see every project\'s status, capture ideas, manage knowledge, and hand off tasks to AI agents. The connective tissue of the holdco — built so that David (and eventually JJ) can run 10+ projects without anything falling through the cracks.',
    tier: 1,
    stage: 'active',
    emoji: '🛸',
    revenue_model: 'Internal tool — enables revenue across all portfolio projects',
    chapters: [
      {
        id: 'what',
        icon: '🛸',
        title: 'What Is Mission Control?',
        type: 'text',
        content:
          'Mission Control is the operating system for the portfolio. It\'s the answer to: "Where is every project right now, what\'s blocked, and what should I be working on?"\n\nBefore this existed, project context lived in notebooks, conversations, and random files. Every AI agent session started cold and had to re-derive what was happening. Every good idea had a 50% chance of dying in a notebook.\n\nMission Control solves all three:\n- **Dashboard**: See every project at a glance — stage, status, blockers, next action\n- **Inbox**: Capture any idea, task, or thought. AI classifies it automatically.\n- **Vault**: Knowledge base — credentials, specs, decisions, everything the AI needs to work\n\nThe repo is the source of truth. Mission Control reflects it. If Mission Control burns down, you rebuild from GitHub. That\'s by design.',
      },
      {
        id: 'roles',
        icon: '👥',
        title: 'Who Uses It',
        type: 'roles',
        roles: [
          {
            who: 'David',
            does: 'Primary user. Full access to all features. Runs every session from here.',
            level: 'full',
          },
          {
            who: 'Vinnie',
            does: 'Can view project status. Read-only for now — no editing or capturing.',
            level: 'view-only',
          },
          {
            who: 'AI agents (Claude Code, Codex, etc.)',
            does: 'Read project context and vault knowledge via MCP tools before starting work. Write status updates and task outcomes when done.',
            level: 'limited',
          },
        ],
      },
      {
        id: 'daily-use',
        icon: '⚡',
        title: 'How to Use It Day-to-Day',
        type: 'steps',
        steps: [
          {
            title: 'Check the dashboard first',
            detail: 'The dashboard shows every project: its stage, current status, blockers, and next action. This is your briefing. Start here every session.',
          },
          {
            title: 'Clear the inbox',
            detail: 'Go to Inbox. Every brain dump from the past 24 hours is there, already classified by AI. Review each one: is it correctly classified? Route it to the right project. Promote ideas to tasks.',
          },
          {
            title: 'Use the Vault for lookups',
            detail: 'Need a credential? A past spec? An AI skill? Go to Vault. Search by keyword. For credentials, click the eye to reveal the value. For vault items, read the content or copy it.',
          },
          {
            title: 'Capture as you go',
            detail: 'See something worth remembering? Click "Capture" in the inbox and type it. Voice input is also available. Don\'t let it live only in your head.',
          },
          {
            title: 'Generate specs for inbox ideas',
            detail: 'For ideas that are ready to build, promote them to a task and generate a spec. The spec bundles project context and the idea into a Claude-ready implementation brief. Hand it to an AI agent.',
          },
          {
            title: 'End every session with a push',
            detail: 'Every build session ends with: (a) push changes to GitHub, (b) update project status in Mission Control. This keeps every future session starting with accurate context.',
          },
        ],
      },
      {
        id: 'scenarios',
        icon: '🔀',
        title: 'Common Situations',
        type: 'scenarios',
        scenarios: [
          {
            if: 'A brain dump got classified as the wrong type',
            then: 'Open the item, click the type badge (e.g., "idea"), and select the correct type from the dropdown. The AI re-routes it accordingly.',
          },
          {
            if: 'Need to find a credential for a project',
            then: 'Go to Vault → Credentials tab. Search by project or name. Click the eye icon to reveal the value. The access is logged.',
          },
          {
            if: 'A project fell off the radar for weeks',
            then: 'Check the dashboard — last_update tells you when it was last touched. Open the project. Read the status and next_action. Read the most recent decisions in decisions.md to re-sync fast.',
          },
          {
            if: 'Starting a new AI agent session on a project',
            then: 'The agent should call mc_get_project_context with the project ID before doing anything. That pulls current status, next action, and blockers. The context is the briefing.',
          },
          {
            if: 'Mission Control is down or unreachable',
            then: 'Fall back to the repo. Read the project\'s CLAUDE.md and decisions.md directly. Push work to GitHub. Notify the operator that MC sync was skipped.',
          },
        ],
      },
    ],
    technical: {
      stack: ['Next.js', 'Supabase (Postgres + Auth + Edge Functions)', 'Vercel', 'TypeScript'],
      integrations: [
        'Anthropic Claude API (Haiku for classification, Sonnet for spec gen)',
        'OpenAI API (second opinions via Codex QC)',
        'Google Gemini API (image work)',
        'GitHub API (repo context sync)',
        'MCP server (agent access to vault and project state)',
      ],
      how_it_works:
        'Next.js frontend with Supabase backend. Projects, brain_dumps, tasks, vault_items, and credentials are stored in Postgres. Brain dumps are classified by Haiku on submission. Vault items get vector embeddings for semantic search. The MCP server exposes scoped read/write tools so AI agents can interact with project state without direct database access.',
      owner: 'David',
      repo: 'github.com/davidbillera-lab/personal-os',
      notes: 'The OS is a swappable command layer — repos are the source of truth. If Mission Control becomes a liability (too fragile, too expensive, better tool emerges), the context survives in git.',
    },
  },
]

export function getRunbook(slug: string): Runbook | undefined {
  return runbooks.find(r => r.slug === slug)
}

export function getAllSlugs(): string[] {
  return runbooks.map(r => r.slug)
}
