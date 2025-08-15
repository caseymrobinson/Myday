# Overview

My Day is an AI-first daily planning assistant that combines calendar integration, intelligent task scheduling, and natural language interaction to help users manage their day effectively. The application provides a unified three-pane interface (tasks, calendar, and chat) with features like Google Calendar integration via iCal URL, smart task management with multiple sources (manual, Slack, AI), AI-powered scheduling suggestions, and natural language chat capabilities.

## Recent Changes (Aug 15, 2025)
- **Fixed task creation validation** - Resolved form validation errors by proper type casting and null handling
- **Added calendar setup interface** - Complete modal with step-by-step Google Calendar iCal URL setup instructions
- **Enhanced UI with calendar setup button** - Added dedicated calendar setup entry point in tasks panel
- **Updated to GPT-5 nano model** - Switched OpenAI integration to use latest cost-effective model
- **Improved user experience** - Professional setup flow with test sync functionality and direct Google Calendar access

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