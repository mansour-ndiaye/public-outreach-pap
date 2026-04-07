export type UserRole        = 'admin' | 'territory_manager' | 'supervisor' | 'field_team'
export type TerritoryStatus = 'active' | 'inactive' | 'pending'
export type AssignmentStatus = 'pending' | 'in_progress' | 'completed'

// supabase-js v2.43+ expects Relationships on every table and CompositeTypes on the schema
export type Database = {
  public: {
    PostgrestVersion: "12"
    Tables: {
      users: {
        Row: {
          id:         string
          email:      string
          full_name:  string | null
          role:       UserRole
          created_at: string
        }
        Insert: {
          id:          string
          email:       string
          full_name?:  string | null
          role?:       UserRole
          created_at?: string
        }
        Update: {
          email?:     string
          full_name?: string | null
          role?:      UserRole
        }
        Relationships: []
      }

      territories: {
        Row: {
          id:          string
          name:        string
          sector:      string | null
          status:      TerritoryStatus
          coordinates: number[][][] | null
          created_at:  string
        }
        Insert: {
          id?:          string
          name:         string
          sector?:      string | null
          status?:      TerritoryStatus
          coordinates?: number[][][] | null
          created_at?:  string
        }
        Update: {
          name?:        string
          sector?:      string | null
          status?:      TerritoryStatus
          coordinates?: number[][][] | null
        }
        Relationships: []
      }

      teams: {
        Row: {
          id:         string
          name:       string
          manager_id: string | null
          created_at: string
        }
        Insert: {
          id?:         string
          name:        string
          manager_id?: string | null
          created_at?: string
        }
        Update: {
          name?:       string
          manager_id?: string | null
        }
        Relationships: []
      }

      team_members: {
        Row: {
          id:         string
          team_id:    string
          user_id:    string
          created_at: string
        }
        Insert: {
          id?:         string
          team_id:     string
          user_id:     string
          created_at?: string
        }
        Update: {
          team_id?: string
          user_id?: string
        }
        Relationships: []
      }

      team_territories: {
        Row: {
          id:           string
          team_id:      string
          territory_id: string
          created_at:   string
        }
        Insert: {
          id?:           string
          team_id:       string
          territory_id:  string
          created_at?:   string
        }
        Update: {
          team_id?:      string
          territory_id?: string
        }
        Relationships: []
      }

      assignments: {
        Row: {
          id:            string
          team_id:       string
          territory_id:  string
          date:          string
          streets_total: number
          streets_done:  number
          recalls:       number
          status:        AssignmentStatus
          created_at:    string
        }
        Insert: {
          id?:            string
          team_id:        string
          territory_id:   string
          date:           string
          streets_total?: number
          streets_done?:  number
          recalls?:       number
          status?:        AssignmentStatus
          created_at?:    string
        }
        Update: {
          team_id?:       string
          territory_id?:  string
          date?:          string
          streets_total?: number
          streets_done?:  number
          recalls?:       number
          status?:        AssignmentStatus
        }
        Relationships: []
      }

      daily_entries: {
        Row: {
          id:               string
          assignment_id:    string
          pac_count:        number
          pac_total_amount: number
          pac_average:      number
          pph:              number
          recalls_count:    number
          created_at:       string
        }
        Insert: {
          id?:               string
          assignment_id:     string
          pac_count?:        number
          pac_total_amount?: number
          pac_average?:      number
          pph?:              number
          recalls_count?:    number
          created_at?:       string
        }
        Update: {
          pac_count?:        number
          pac_total_amount?: number
          pac_average?:      number
          pph?:              number
          recalls_count?:    number
        }
        Relationships: []
      }
    }

    Views: Record<string, never>

    Functions: {
      get_my_role: {
        Args:    Record<string, never>
        Returns: UserRole
      }
    }

    Enums: {
      user_role:         UserRole
      territory_status:  TerritoryStatus
      assignment_status: AssignmentStatus
    }

    CompositeTypes: Record<string, never>
  }
}
