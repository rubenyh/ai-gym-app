export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      body_weight_entries: {
        Row: {
          created_at: string
          id: string
          measured_at: string
          owner_id: string
          updated_at: string
          weight_grams: number
        }
        Insert: {
          created_at?: string
          id?: string
          measured_at: string
          owner_id?: string
          updated_at?: string
          weight_grams: number
        }
        Update: {
          created_at?: string
          id?: string
          measured_at?: string
          owner_id?: string
          updated_at?: string
          weight_grams?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string
          handle: string
          id: string
          updated_at: string
          visibility: Database["public"]["Enums"]["profile_visibility"]
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name: string
          handle: string
          id?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["profile_visibility"]
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          handle?: string
          id?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["profile_visibility"]
        }
        Relationships: []
      }
      training_profiles: {
        Row: {
          age: number | null
          available_weekdays: number[]
          created_at: string
          equipment: string[]
          experience: Database["public"]["Enums"]["experience_level"] | null
          goal: string | null
          height_cm: number | null
          limitations: string | null
          owner_id: string
          session_minutes: number | null
          updated_at: string
        }
        Insert: {
          age?: number | null
          available_weekdays?: number[]
          created_at?: string
          equipment?: string[]
          experience?: Database["public"]["Enums"]["experience_level"] | null
          goal?: string | null
          height_cm?: number | null
          limitations?: string | null
          owner_id?: string
          session_minutes?: number | null
          updated_at?: string
        }
        Update: {
          age?: number | null
          available_weekdays?: number[]
          created_at?: string
          equipment?: string[]
          experience?: Database["public"]["Enums"]["experience_level"] | null
          goal?: string | null
          height_cm?: number | null
          limitations?: string | null
          owner_id?: string
          session_minutes?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          length_unit: Database["public"]["Enums"]["length_unit"]
          owner_id: string
          timezone: string
          updated_at: string
          weight_unit: Database["public"]["Enums"]["weight_unit"]
        }
        Insert: {
          created_at?: string
          length_unit: Database["public"]["Enums"]["length_unit"]
          owner_id?: string
          timezone: string
          updated_at?: string
          weight_unit: Database["public"]["Enums"]["weight_unit"]
        }
        Update: {
          created_at?: string
          length_unit?: Database["public"]["Enums"]["length_unit"]
          owner_id?: string
          timezone?: string
          updated_at?: string
          weight_unit?: Database["public"]["Enums"]["weight_unit"]
        }
        Relationships: []
      }
      weekly_goals: {
        Row: {
          created_at: string
          effective_week: string
          owner_id: string
          target_days: number
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_week: string
          owner_id?: string
          target_days: number
          timezone: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_week?: string
          owner_id?: string
          target_days?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_onboarding: {
        Args: {
          p_display_name: string
          p_handle: string
          p_length_unit: Database["public"]["Enums"]["length_unit"]
          p_target_days: number
          p_timezone: string
          p_weight_unit: Database["public"]["Enums"]["weight_unit"]
        }
        Returns: undefined
      }
      has_weekly_goal: { Args: { uid: string }; Returns: boolean }
      is_valid_timezone: { Args: { tz: string }; Returns: boolean }
      schedule_weekly_goal: { Args: { p_target_days: number }; Returns: string }
      week_start: { Args: { ts: string; tz: string }; Returns: string }
    }
    Enums: {
      experience_level: "beginner" | "intermediate" | "advanced"
      length_unit: "cm" | "ft_in"
      profile_visibility: "public" | "private"
      weight_unit: "kg" | "lb"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      experience_level: ["beginner", "intermediate", "advanced"],
      length_unit: ["cm", "ft_in"],
      profile_visibility: ["public", "private"],
      weight_unit: ["kg", "lb"],
    },
  },
} as const

