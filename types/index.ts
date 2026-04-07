export type { Database, UserRole, TerritoryStatus, AssignmentStatus } from './database'

export type Locale = 'fr' | 'en'

// Convenience row types
import type { Database } from './database'
export type UserRow            = Database['public']['Tables']['users']['Row']
export type TerritoryRow       = Database['public']['Tables']['territories']['Row']
export type TeamRow            = Database['public']['Tables']['teams']['Row']
export type TeamMemberRow      = Database['public']['Tables']['team_members']['Row']
export type TeamTerritoryRow   = Database['public']['Tables']['team_territories']['Row']
export type AssignmentRow      = Database['public']['Tables']['assignments']['Row']
export type DailyEntryRow      = Database['public']['Tables']['daily_entries']['Row']

// Enriched team type with joined data (used in Teams management page)
export type TeamWithDetails = {
  id:           string
  name:         string
  created_at:   string
  manager_id:   string | null
  manager_name: string | null
  member_ids:   string[]
  territory_ids: string[]
}
