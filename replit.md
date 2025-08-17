# Overview

My Day is an AI-first daily planning assistant that combines calendar integration, intelligent task scheduling, and natural language interaction to help users manage their day effectively. The application provides a unified three-pane interface (tasks, calendar, and chat) with features like Google Calendar integration via iCal URL, smart task management with multiple sources (manual, Slack, AI), AI-powered scheduling suggestions, and natural language chat capabilities.

## Recent Changes (Aug 17, 2025)
- **✅ COMPLETED: Advanced Calendar Service Optimization** - User refined calendar-v2.ts with significant performance improvements
  - **Optimized sync performance**: Calendar sync now completes in ~80 seconds (down from 3+ minutes)
  - **Perfect accuracy**: Successfully processes all 818 relevant events with 0 errors and 0 skipped events
  - **Enhanced refresh functionality**: Clean delete/resync cycle works flawlessly for testing
  - **Month-based processing**: Events processed in monthly slices to prevent memory crashes with 25MB+ calendars
  - **Proper recurrence expansion**: Uses node-ical parser with controlled processing and memory management
  - **Unique occurrence IDs**: Format `${uid}::${start.toISOString()}` prevents database collisions for recurring events
  - **Upsert logic**: Intelligent event creation with update fallback for data consistency
  - **Memory optimization**: Successfully processes 3,393 calendar items, stores 818 relevant events
  - **Comprehensive error handling**: Detailed sync statistics and error tracking
  - **Cron automation**: 15-minute sync intervals with proper job management
- **✅ VERIFIED: Production-Ready Calendar System** - Calendar handles large calendars efficiently
  - Processes 25MB calendar files without memory crashes
  - Real-time calendar refresh and sync capabilities
  - Date range: Past 9 months to future 3 months (Nov 2024 - Nov 2025)
  - Seamless integration with task scheduling and AI suggestions

## Previous Changes (Aug 16, 2025)
- **Dynamic AI Prompt Visibility** - Floating AI chat bubble now intelligently hides when chat panel is open and shows when closed for clean, non-redundant interface
- **Complete UI Refinement** - Removed all borders in favor of proper background layering (gray-900 headers, gray-950 action areas, black content)
- **Enhanced Button Layout** - Plan My Day now uses AI Bot icon, settings moved inline with action buttons, removed redundant floating chat button
- **Functional Date Navigation** - Calendar date selector now properly changes dates and triggers data refreshes
- **Streamlined Interface** - Removed non-functional overflow menu for cleaner design
- **Major UI Overhaul** - Complete dark theme redesign with modern, sleek interface matching provided mockups
- **Enhanced Task Cards** - New design with pill badges for time, priority, and due dates
- **Improved Calendar View** - Hourly time slots with visual indicators for meetings, confirmed tasks, and AI suggestions
- **Redesigned Chat Interface** - Beautiful gradient chat bubble with quick action buttons and improved message styling
- **Dark Theme Throughout** - Consistent dark theme across all components including modals and dialogs
- **Fixed chat functionality** - Corrected OpenAI model from "gpt-5-mini" to "gpt-4o-mini" for stable chat operations
- **Enhanced AI task creation** - Chat now intelligently detects task creation requests from any text, not just emails
- **Added conversation memory** - Chat maintains context across messages within a session for more natural interactions
- **Fixed task deletion** - Resolved foreign key constraint errors by properly handling associated focus blocks
- **Implemented task editing** - Added full edit functionality with dialog interface for title, priority, and time estimates
- **Fixed overlapping calendar events** - Events now display side-by-side when times conflict instead of overlapping
- **Implemented database persistence** - Migrated from in-memory to PostgreSQL storage for permanent data retention
- **Calendar URL persistence** - iCal URL now stored in database and persists across builds/updates
- **Enhanced task detection patterns** - AI recognizes various task creation patterns like "I need to", "remind me to", etc.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **React + Vite + TypeScript**: Modern frontend stack with TypeScript for type safety
- **Tailwind CSS + shadcn/ui**: Utility-first CSS framework with a comprehensive component library
- **Three-pane responsive layout**: Tasks panel (left), calendar panel (center), and chat panel (right)
- **React Query (@tanstack/react-query)**: Data fetching, caching, and synchronization
- **Wouter**: Lightweight client-side routing

## Backend Architecture
- **Node.js + Express + TypeScript**: RESTful API server with type safety
- **Drizzle ORM with PostgreSQL**: Type-safe database operations with schema-first approach
- **In-memory storage fallback**: MemStorage class for development/testing when database is unavailable
- **Modular service architecture**: Separate services for calendar, scheduler, and OpenAI integration
- **Cron job scheduling**: Automated calendar synchronization every 15 minutes using node-cron

## Data Models
- **Tasks**: Core entity with title, source (manual/slack/ai), status (pending/confirmed/done), priority, due dates, time estimates, and AI suggestions
- **Focus Blocks**: Time-bound task scheduling with confirmation workflow
- **Calendar Events**: Read-only calendar data normalized from iCal feeds

## AI Integration
- **OpenAI GPT-4o**: Natural language processing for chat interactions and schedule summaries
- **Intent recognition**: Pattern matching for schedule queries and task extraction
- **Smart scheduling**: Greedy algorithm for fitting tasks into free time blocks between meetings

## Calendar Integration
- **iCal URL ingestion**: Read-only Google Calendar integration without OAuth complexity
- **node-ical parser**: Event normalization and data extraction
- **Automatic synchronization**: 15-minute intervals with conflict resolution

## Task Management System
- **Multi-source tasks**: Support for manual entry, Slack integration, and AI-generated tasks
- **Priority-based organization**: 1-3 priority levels with intelligent sorting
- **Status workflow**: Pending → Confirmed → Done with optional AI suggestion confirmation
- **Time estimation**: Default 30-minute blocks with custom estimates

# External Dependencies

## Core Infrastructure
- **PostgreSQL (via Neon)**: Primary database with connection pooling
- **Drizzle ORM**: Type-safe database operations and migrations

## AI Services
- **OpenAI API (GPT-4o)**: Natural language processing and conversation handling

## Calendar Integration
- **Google Calendar**: Read-only access via secret iCal URLs (no OAuth required)
- **node-ical**: iCal feed parsing and event extraction

## UI Components
- **Radix UI**: Accessible, unstyled component primitives for complex UI elements
- **Tailwind CSS**: Utility-first styling framework
- **Lucide React**: Icon library for consistent iconography

## Development Tools
- **Vite**: Fast development server and build tool
- **TypeScript**: Type safety across frontend and backend
- **ESBuild**: Fast bundling for production builds

## Scheduling & Automation
- **node-cron**: Automated calendar synchronization jobs
- **date-fns**: Date manipulation and formatting utilities

## Optional Integrations
- **Slack**: Webhook endpoint for task ingestion (stub implementation)
- **Focus blocks**: Time management and productivity tracking