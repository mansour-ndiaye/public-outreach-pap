export type { Database, UserRole, TerritoryStatus, AssignmentStatus } from './database'

export type Locale = 'fr' | 'en'

// Convenience row types
import type { Database } from './database'
export type UserRow       = Database['public']['Tables']['users']['Row']
export type TerritoryRow  = Database['public']['Tables']['territories']['Row']
export type TeamRow       = Database['public']['Tables']['teams']['Row']
export type AssignmentRow = Database['public']['Tables']['assignments']['Row']
export type DailyEntryRow = Database['public']['Tables']['daily_entries']['Row']
