export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      academic_terms: {
        Row: {
          created_at: string
          end_date: string
          id: string
          is_active: boolean
          name: string
          start_date: string
          starting_marks: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          is_active?: boolean
          name: string
          start_date: string
          starting_marks?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          is_active?: boolean
          name?: string
          start_date?: string
          starting_marks?: number
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          payload: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          payload?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          payload?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      conduct_logs: {
        Row: {
          created_at: string
          entry_type: string
          id: string
          marks: number
          occurred_on: string
          offense_id: string | null
          reason: string | null
          recorded_by: string | null
          student_id: string
          term_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entry_type?: string
          id?: string
          marks: number
          occurred_on?: string
          offense_id?: string | null
          reason?: string | null
          recorded_by?: string | null
          student_id: string
          term_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entry_type?: string
          id?: string
          marks?: number
          occurred_on?: string
          offense_id?: string | null
          reason?: string | null
          recorded_by?: string | null
          student_id?: string
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conduct_logs_offense_id_fkey"
            columns: ["offense_id"]
            isOneToOne: false
            referencedRelation: "offenses_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conduct_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_conduct_balances"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "conduct_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conduct_logs_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conduct_logs_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "student_conduct_balances"
            referencedColumns: ["term_id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          conduct_log_id: string | null
          created_at: string
          error_message: string | null
          id: string
          message_body: string
          recipient_phone: string | null
          sent_at: string | null
          status: string
          student_id: string | null
        }
        Insert: {
          conduct_log_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_body: string
          recipient_phone?: string | null
          sent_at?: string | null
          status?: string
          student_id?: string | null
        }
        Update: {
          conduct_log_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_body?: string
          recipient_phone?: string | null
          sent_at?: string | null
          status?: string
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_conduct_log_id_fkey"
            columns: ["conduct_log_id"]
            isOneToOne: false
            referencedRelation: "conduct_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_conduct_balances"
            referencedColumns: ["student_id"]
          },
          {
            foreignKeyName: "notification_logs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      offenses_catalog: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          marks_deducted: number
          severity: string
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          marks_deducted?: number
          severity?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          marks_deducted?: number
          severity?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          job_title: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          job_title?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          job_title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      school_settings: {
        Row: {
          academic_year: string
          critical_threshold: number
          id: number
          logo_url: string | null
          notify_on_threshold: boolean
          school_name: string
          updated_at: string
          warning_threshold: number
        }
        Insert: {
          academic_year?: string
          critical_threshold?: number
          id?: number
          logo_url?: string | null
          notify_on_threshold?: boolean
          school_name?: string
          updated_at?: string
          warning_threshold?: number
        }
        Update: {
          academic_year?: string
          critical_threshold?: number
          id?: number
          logo_url?: string | null
          notify_on_threshold?: boolean
          school_name?: string
          updated_at?: string
          warning_threshold?: number
        }
        Relationships: []
      }
      students: {
        Row: {
          admission_no: string
          cell: string | null
          class_level: string | null
          class_name: string
          created_at: string
          date_of_birth: string | null
          district: string | null
          first_name: string | null
          full_name: string
          gender: string | null
          house: string | null
          id: string
          is_active: boolean
          last_name: string | null
          parent_name: string | null
          parent_phone: string | null
          sector: string | null
          stream: string | null
          updated_at: string
        }
        Insert: {
          admission_no: string
          cell?: string | null
          class_level?: string | null
          class_name: string
          created_at?: string
          date_of_birth?: string | null
          district?: string | null
          first_name?: string | null
          full_name: string
          gender?: string | null
          house?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          sector?: string | null
          stream?: string | null
          updated_at?: string
        }
        Update: {
          admission_no?: string
          cell?: string | null
          class_level?: string | null
          class_name?: string
          created_at?: string
          date_of_birth?: string | null
          district?: string | null
          first_name?: string | null
          full_name?: string
          gender?: string | null
          house?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          sector?: string | null
          stream?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      student_conduct_balances: {
        Row: {
          admission_no: string | null
          class_name: string | null
          current_marks: number | null
          entries_count: number | null
          full_name: string | null
          house: string | null
          marks_deducted: number | null
          marks_restored: number | null
          parent_phone: string | null
          starting_marks: number | null
          student_id: string | null
          term_id: string | null
          term_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_audit_viewer: { Args: { _user_id: string }; Returns: boolean }
      is_discipline_staff: { Args: { _user_id: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "discipline_admin" | "school_leader" | "system_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["discipline_admin", "school_leader", "system_admin"],
    },
  },
} as const
