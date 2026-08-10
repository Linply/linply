/**
 * English is the source dictionary: `zh` is typed as `Dictionary`, so a missing
 * or misspelled key fails the build rather than silently falling back.
 *
 * Values that need runtime data are functions instead of `%s` placeholders —
 * that keeps argument types checked and lets each language order words freely.
 */
import type { AgentActivityDictionary } from "@/components/agentTimeline";

export const en = {
  common: {
    save: "Save",
    cancel: "Confirm",
    confirm: "Confirm",
    delete: "Delete",
    edit: "Edit",
    back: "Back",
    next: "Next",
    previous: "Back",
    loading: "Loading",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Copy failed, please select it manually",
    preview: "Preview",
    close: "Close",
    retry: "Retry",
    search: "Search",
    all: "All",
    none: "None",
    unnamed: "Unnamed",
    saveFailed: "Save failed",
    settings: "Settings",
    signOut: "Sign out",
    language: "Language",
  },

  nav: {
    groupDaily: "Daily",
    groupAgent: "My agent",
    groupSettings: "Settings",
    dashboard: "Home",
    inbox: "Conversations",
    tickets: "Tickets",
    knowledge: "Knowledge",
    chat: "Test chat",
    channels: "Channels",
    settings: "Agent settings",
    ragDebug: "Retrieval debug",
    openNav: "Open navigation",
    closeNav: "Close navigation",
    defaultWorkspace: "My support workspace",
  },

  auth: {
    heroLine1: "Your knowledge,",
    heroLine2: "answering for you",
    heroSubtitle:
      "One workspace each. Import what you know, then plug it into wherever your customers are.",
    tabLogin: "Sign in",
    tabRegister: "Sign up",
    switchTo: (label: string) => `Switch to ${label}`,
    loginTitle: "Sign in to your account",
    registerTitle: "Create your account",
    name: "Name",
    namePlaceholder: "What should we call you",
    email: "Email",
    password: "Password",
    passwordPlaceholder: "Enter your password",
    passwordHint: "At least 8 characters",
    confirmPassword: "Confirm password",
    confirmPasswordPlaceholder: "Enter it again",
    showPassword: "Show password",
    hidePassword: "Hide password",
    signIn: "Sign in",
    signUp: "Sign up",
    haveAccount: "Already have an account?",
    noAccount: "No account yet?",
    orContinueWith: "or continue with",
    passwordMismatch: "The two passwords do not match",
    oauthDenied: "Google sign-in was cancelled",
    oauthInvalidState: "This sign-in request expired, please try again",
    oauthLinkRequired:
      "That email is already registered — sign in with your password first",
    oauthFailed: "Google sign-in failed, please try again later",
  },

  onboarding: {
    brandTagline: "Build your own support agent",
    stepOf: (current: number, total: number) => `Step ${current} of ${total}`,
    skip: "Skip setup and go to the workspace",

    profileTitle: "Tell us about your business",
    profileSummary: "What it is called and how it speaks",
    profileIntro:
      "This goes straight into the agent's system prompt: what it calls itself, how it sounds, and how much it knows about your business.",
    workspaceName: "Workspace name",
    workspaceNameHint: "Only you see this",
    workspaceNamePlaceholder: "e.g. Acme Home Support",
    agentName: "Agent name",
    agentNameHint: "Customers see this",
    agentNamePlaceholder: "e.g. Acme Assistant",
    tone: "Tone",
    businessContext: "Business context",
    businessContextHint: "Optional, but strongly recommended",
    businessContextPlaceholder:
      "What you sell, who you serve, what people ask most. e.g. We are a home goods brand selling mattresses and bedding; customers mostly ask about shipping times and returns.",
    saveAndContinue: "Save and continue",

    knowledgeTitle: "Import your knowledge",
    knowledgeSummary: "Feed it your FAQs",
    pasteTitle: "Paste your FAQs",
    pasteHint: "Split with ## headings — each section becomes one entry.",
    entryCount: (count: number) => `${count} entries`,
    importPasted: "Import this",
    fillSample: "Use sample",
    uploadTitle: "Or upload a file",
    uploadHint:
      "Markdown (split by heading) and CSV (header: title,content,category,keywords).",
    chooseFile: "Choose file",
    fileTooLarge:
      "Pick a file under 2MB — larger files can be uploaded from the Knowledge page",
    emptyContent: "Content cannot be empty",
    noEntriesParsed:
      "No entries were parsed. Markdown needs ## headings; CSV needs title/content columns.",
    imported: (count: number) => `Imported ${count} entries`,
    importFailed: "Import failed",
    noKnowledgeWarning:
      "Without knowledge, the agent can only say it is unsure",

    previewTitle: "Try it once",
    previewSummary: "Check whether the answers hold up",
    previewSubtitle: "This is exactly what customers will see",
    previewEmpty: "Ask something your customers actually ask",
    previewPlaceholder: "Type a customer question…",
    previewNoModel:
      "If the model is not configured yet, skip this step and come back after setting OPENAI_API_KEY.",

    channelTitle: "Plug it in",
    channelSummary: "Share link or Telegram",
    shareLinkTitle: "Share link",
    shareLinkHint:
      "The fastest option. Customers just open it — no sign-up needed.",
    ready: "Ready",
    telegramTitle: "Telegram",
    telegramHint:
      "Three steps: find @BotFather in Telegram → send /newbot → paste the token below.",
    connected: "Connected",
    telegramConnectedHint:
      "The bot is live. Send it a message in Telegram to try it.",
    connect: "Connect",
    connectedVia: (name: string) => `Connected ${name}`,
    connectedViaPolling: (name: string) =>
      `Connected ${name} (polling for messages in local development)`,
    connectFailed: "Connection failed",
    finish: "Finish setup",
  },

  tone: {
    friendly: "Friendly",
    friendlyHint: "Natural and warm, good for consumers",
    professional: "Professional",
    professionalHint: "Formal and measured, good for business",
    concise: "Concise",
    conciseHint: "One sentence when one will do",
  },

  dashboard: {
    title: "Home",
    workingFor: (agentName: string) => `${agentName} is on duty`,
    subtitle:
      "Only your data lives here: the knowledge you imported, your customers, your channels.",
    remainingSteps: (count: number) =>
      `${count} ${count === 1 ? "step" : "steps"} left`,
    checklistContext: "Fill in business context",
    checklistKnowledge: "Import knowledge",
    checklistPreview: "Verify the answers",
    checklistChannel: "Connect a channel",
    goFill: "Fill in",
    goImport: "Import",
    goTest: "Try it",
    goConnect: "Connect",
    statKnowledge: "Knowledge entries",
    statKnowledgeSearchable: (count: number) => `${count} searchable`,
    statKnowledgeQuarantined: (count: number) => `${count} awaiting review`,
    statContacts: "Customers",
    statContactsActive: (count: number) => `${count} active in the last 7 days`,
    statMessages: "Messages",
    statMessagesRecent: (count: number) => `${count} in the last 7 days`,
    statOpenTickets: "Open tickets",
    statTicketsTotal: (count: number) => `${count} total`,
    shareLink: "Share link",
    shareLinkDisabled:
      "The share link is off. Turn it back on in Agent settings.",
    quickAccess: "Jump to",
    shortcutInbox: "Conversations",
    shortcutInboxHint: "Real conversations coming in from your channels",
    shortcutKnowledge: "Knowledge",
    shortcutKnowledgeHint: "What the agent bases its answers on",
    shortcutChat: "Test chat",
    shortcutChatHint: "Ask it yourself, check the answers and citations",
    shortcutChannels: "Channels",
    shortcutChannelsHint: "Share link, Telegram",
    shortcutTickets: "Tickets",
    shortcutTicketsHint: "Created when the agent hands off to a human",
  },

  channels: {
    title: "Channels",
    subtitle: "Put your agent where your customers already are",
    statusConnected: "Connected",
    statusPending: "Pending",
    statusError: "Error",
    statusDisabled: "Disabled",
    customerUrl: "Customer-facing URL",
    shareLinkOff:
      "The link is off and returns 404. Turn it back on in Agent settings.",
    botAccount: "Bot",
    deliveryMode: "Delivery",
    deliveryWebhook: "Webhook",
    deliveryPolling: "Local polling (no public address)",
    lastError: (message: string) => `Last error: ${message}`,
    open: (name: string) => `Open ${name}`,
    pauseAutoReply: "Pause auto-reply",
    resumeAutoReply: "Resume auto-reply",
    autoReplyPaused:
      "Auto-reply is paused: messages are still recorded under Conversations, but the agent will not answer.",
    disconnect: "Disconnect",
    disconnectTitle: "Disconnect Telegram?",
    disconnectDescription:
      "The bot will stop receiving and answering messages. Existing conversations are kept, and you can reconnect by pasting the token again.",
    disconnectConfirm: "Disconnect",
    disconnected: "Disconnected",
    telegramStep1: "1. Search @BotFather in Telegram and send /newbot",
    telegramStep2: "2. Follow the prompts to get a token like 123456:AA…",
    telegramStep3: "3. Paste the token here",
    noPublicUrl:
      "There is no public HTTPS address right now, so messages will be received by polling. Local development works the same way.",
    planned: "Planned",
    plannedNote:
      "Both require creating an app and going through OAuth on their platform — there is no paste-one-token path like Telegram, so they come later.",
  },

  channelProviders: {
    web: {
      name: "Share link",
      tagline: "A sign-in-free chat page — send the link and it just works",
    },
    telegram: {
      name: "Telegram",
      tagline: "Create a bot with BotFather, paste the token, done",
    },
    slack: {
      name: "Slack",
      tagline: "Needs a Slack App and OAuth setup — planned",
    },
    feishu: {
      name: "Feishu / Lark",
      tagline: "Needs a custom app on the open platform — planned",
    },
  },

  inbox: {
    title: "Conversations",
    subtitle: "Real conversations coming in from your channels",
    emptyTitle: "No customers yet",
    emptyHint:
      "Grab the share link or connect Telegram under Channels, and conversations will show up here.",
    noMessages: "(no messages)",
    selectContact: "Pick a customer on the left to see the full conversation",
    visitor: (id: number) => `Visitor #${id}`,
    messageCount: (count: number) => `${count} messages`,
    citedKnowledge: (count: number) => `cited ${count} entries`,
    readOnlyNote:
      "This is a read-only record. The agent replies automatically — to change how it answers, edit your knowledge or agent settings.",
  },

  chat: {
    title: "Test chat",
    subtitle: "Ask as a customer would; check answers, citations and steps",
    emptyTitle: "Say something to your agent",
    emptySubtitle:
      "This is what customers see. Not happy with an answer? Edit the knowledge or the settings — it takes effect immediately.",
    starter1: "How do returns work?",
    starter2: "How long until it ships?",
    starter3: "How do I get an invoice?",
    starter4: "Can I change the delivery address?",
    inputPlaceholder: "Type a message",
    quotaExhaustedPlaceholder: "Out of credits for today",
    send: "Send message",
    composerHint:
      "Enter to send, Shift + Enter for a new line. Answers come from your own knowledge and may still be wrong.",
    quotaExhausted: "Out of credits for today — try again after the reset",
    quotaLow: (credits: number) => `Credits running low — ${credits} left`,
    citations: (count: number) => `Sources · ${count} entries`,
    typing: (agentName: string) => `${agentName} is typing`,
    showActivityDetails: "Show details",
    retry: "Try again",
    degraded:
      "Knowledge search fell back to keywords, so this answer is worth a human check.",
    convertToTicket: "Turn into a ticket",
    openTicket: (id: number) => `Open ticket #${id}`,
  },

  publicChat: {
    inputPlaceholder: "Ask your question…",
    poweredBy: "Powered by Linply",
    notFound: "This support link does not exist or has been turned off",
    notFoundHint: "Please ask the business for an up-to-date link.",
    connectError: "Cannot reach the support service, please try again later",
    sendFailed: "Sending failed, please try again later",
    networkError: "Network problem, please try again later",
  },

  settings: {
    title: "Agent settings",
    subtitle:
      "What your agent is called, how it speaks, what it does when stuck",
    saved: "Saved — it takes effect on the next conversation",
    identityTitle: "Identity",
    identityDescription:
      "Customers see the agent name; the workspace name is only for you.",
    scriptsTitle: "Scripts",
    scriptsDescription:
      "The greeting opens a conversation; the fallback is used when the knowledge base has no answer.",
    greeting: "Greeting",
    greetingHint: "Leave empty to use the default",
    greetingPlaceholder:
      "Hi, I'm the Acme Assistant. Ask me anything about shipping, returns or invoices.",
    fallback: "Fallback reply",
    fallbackHint: "What to say when it does not know",
    fallbackPlaceholder:
      "I can't find a confident answer to that. I've noted it down and a teammate will follow up within 24 hours.",
    businessTitle: "Business context",
    businessDescription:
      "Describe what you sell and who you serve. This enters the system prompt as trusted context and noticeably improves answers.",
    shareTitle: "Share link",
    shareDescription:
      "Turning this off disables the public chat page immediately. Telegram is unaffected.",
    shareToggle: "Allow sign-in-free chat through the share link",
    saveSettings: "Save settings",
    modelTitle: "Model",
    modelDescription:
      "Which model writes the answers. Stronger models reason better over messy questions; smaller ones reply faster and cost less per conversation.",
    modelLabel: "Answering model",
    modelDefaultOption: (model: string) => `Follow the deployment (${model})`,
    modelDefaultHint: "Whatever this deployment is configured with",
    modelContextWindow: (tokens: string) => `${tokens} context`,
    modelUnavailable:
      "No models to list — this deployment has no OPENAI_API_KEY set, so the agent cannot answer yet either.",
    modelTiers: {
      flagship: "Strongest reasoning",
      balanced: "Balanced",
      fast: "Fastest and cheapest",
      reasoning: "Reasoning model",
    },
  },

  plans: {
    title: "Plans",
    subtitle: "Start free. Upgrade when your volume outgrows it.",
    currentPlan: "Current plan",
    perMonth: "/mo",
    free: "Free",
    freeTagline: "Enough to get a real agent live",
    pro: "Pro",
    proTagline: "For a growing store or product",
    business: "Business",
    businessTagline: "For teams handling real volume",
    selfHosted: "Self-hosted",
    selfHostedTagline: "Run it yourself, no limits, no bill",
    current: "Current",
    upgrade: "Upgrade",
    downgrade: "Switch",
    contactUs: "Get the source",
    unlimited: "Unlimited",
    limitKnowledge: "Knowledge entries",
    limitTokens: "Daily credits",
    limitChannels: "Connected channels",
    limitContacts: "Customers / 30 days",
    featureShareLink: "Share link",
    featureTelegram: "Telegram",
    featureRemoveBranding: "Remove Linply branding",
    featureCustomerCards: "Customer cards",
    featurePrioritySupport: "Priority support",
    usageTitle: "Your usage",
    usageOf: (used: number, limit: string) => `${used} of ${limit}`,
    billingNotice:
      "Payment is not connected yet. Choosing a plan records your request — nothing is charged and your workspace stays on its current plan until we follow up.",
    requested: (plan: string) => `Requested ${plan} — we will be in touch`,
    cancelRequest: "Cancel request",
    requestFailed: "Could not record the request",
    limitReached: (limit: string) =>
      `You reached your plan limit (${limit}). Upgrade to continue.`,
  },

  credits: {
    label: "Credit",
    unlimited: "Unlimited",
    view: "View credit usage",
    title: "Credit usage",
    observationMode: "Observation mode",
    available: "Available",
    dailyQuota: "Daily quota",
    used: "Used",
    reserved: "Reserved in flight",
    resetAt: "Resets at",
    footnote: "1 Credit = 1,000 tokens. Quota resets on the UTC day boundary.",
  },

  knowledge: {
    title: "Knowledge",
    subtitle:
      "The only thing your agent answers from, private to your workspace",
    debugEntry: "Retrieval debug",
    addEntry: "New entry",
  },

  ragDebug: {
    title: "Retrieval debug",
    subtitle:
      "See which entries a question recalls, and whether by vector or keyword",
  },

  tickets: {
    title: "Tickets",
    resultCount: (count: number) => `${count} results`,
    create: "New ticket",
    createTitle: "New ticket",
    createSubtitle: "Record something that needs a human",
    detailTitle: (id: number) => `Ticket #${id}`,
    notFound: "This ticket does not exist or is not in your workspace",
    backToTickets: "Back to tickets",
    ticketNumber: (id: number) => `Ticket #${id}`,
    statusLabels: {
      pending: "Pending",
      in_progress: "In progress",
      resolved: "Resolved",
      closed: "Closed",
    },
    priorityLabels: {
      low: "Low",
      medium: "Medium",
      high: "High",
      urgent: "Urgent",
    },
    priorityBadge: (priority: string) => `${priority} priority`,
    noteLabels: {
      status_change: "Status change",
      comment: "Internal note",
      assignment: "Assignment",
      system: "System",
    },
    unknownNote: "Activity",
    descriptionTitle: "Issue",
    activityTitle: "Activity",
    activitySubtitle: "Notes and status changes in chronological order",
    addNoteAria: "Add ticket note",
    addNotePlaceholder: "Add progress or customer feedback",
    addNote: "Add note",
    noteAdded: "Note added",
    addNoteFailed: "Could not add the note",
    noActivity: "No activity yet",
    relatedChatTitle: "Related conversation",
    relatedChatSubtitle: "The conversation that led to this ticket",
    customer: "Customer",
    agent: "AI agent",
    noRelatedChat: "No related conversation",
    ticketInfo: "Ticket details",
    status: "Status",
    priority: "Priority",
    number: "Number",
    handleTicket: "Handle ticket",
    startProcessing: "Start processing",
    markResolved: "Mark as resolved",
    resolveAndNotify: "Resolve and notify customer",
    closeTicket: "Close ticket",
    reprocess: "Resume processing",
    reopen: "Reopen",
    updatePriority: "Update priority",
    selectPriority: "Select priority",
    applyPriority: "Apply priority",
    statusUpdated: "Ticket status updated",
    notificationFailed:
      "Ticket status updated, but the customer notification failed",
    resolutionNotified: "Ticket resolved and customer notified",
    updateFailed: "Update failed",
    priorityUpdated: "Priority updated",
  },

  agentRun: {
    title: "Run details",
    subtitle: "Agent execution steps and usage",
    notFound: "Agent Run not found",
    notFoundHint:
      "Check that the Run ID is complete, and that it belongs to your workspace",
    backToChat: "Back to test chat",
    noArgs: "No arguments",
    noResult: "No result yet",
    stepLabels: {
      thinking: "Thinking",
      tool_call: "Tool call",
      tool_result: "Result",
      final: "Final answer",
      error: "Failed",
    },
  },

  /**
   * One line per thing the agent does, rendered from the key the server sends.
   * Keep them short enough to sit on a single row and phrased as an action —
   * the reader is watching work happen, not reading a log.
   */
  agentActivity: {
    thinking: () => "Reading your question",
    "searchKnowledge.running": ({ query }) =>
      query ? `Looking up “${query}”` : "Searching your knowledge",
    "searchKnowledge.done": ({ count = 0 }) =>
      `Found ${count} matching ${count === 1 ? "entry" : "entries"}`,
    "searchKnowledge.empty": () => "Nothing in the knowledge base on this",
    "createTicket.running": ({ query }) =>
      query ? `Opening a ticket: ${query}` : "Opening a ticket",
    "createTicket.done": ({ ticketId }) =>
      ticketId ? `Ticket #${ticketId} created` : "Ticket created",
    "createTicket.replayed": ({ ticketId }) =>
      ticketId
        ? `Ticket #${ticketId} already existed`
        : "Ticket already existed",
    "listTickets.running": () => "Checking your tickets",
    "listTickets.done": ({ count = 0 }) =>
      `Found ${count} ticket${count === 1 ? "" : "s"}`,
    "listTickets.empty": () => "No tickets found",
    "getTicketById.running": ({ ticketId }) =>
      ticketId ? `Opening ticket #${ticketId}` : "Opening the ticket",
    "getTicketById.done": ({ ticketId }) =>
      ticketId ? `Read ticket #${ticketId}` : "Read the ticket",
    "addTicketNote.running": ({ ticketId }) =>
      ticketId ? `Adding a note to ticket #${ticketId}` : "Adding a note",
    "addTicketNote.done": ({ ticketId }) =>
      ticketId ? `Note added to ticket #${ticketId}` : "Note added",
    "tool.running": ({ label }) => (label ? `Working on ${label}` : "Working"),
    "tool.done": ({ label }) => (label ? `${label} done` : "Done"),
    "tool.error": ({ label }) =>
      label ? `Couldn’t finish: ${label}` : "That step didn’t finish",
  } as AgentActivityDictionary,

  /** Used when a step failed and we have to name the tool in plain words. */
  agentToolLabels: {
    searchKnowledge: "the knowledge search",
    createTicket: "creating the ticket",
    listTickets: "the ticket list",
    getTicketById: "the ticket details",
    addTicketNote: "the ticket note",
  } as Record<string, string>,
};

/**
 * No `as const`: literal value types would make every `zh` string a type error.
 * The object shape is still captured, so a missing key in `zh` fails the build.
 */
export type Dictionary = typeof en;
