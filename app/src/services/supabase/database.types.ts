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
      account_sync_state: {
        Row: {
          last_seq: number
          owner_id: string
        }
        Insert: {
          last_seq?: number
          owner_id: string
        }
        Update: {
          last_seq?: number
          owner_id?: string
        }
        Relationships: []
      }
      achievement_unlocks: {
        Row: {
          badge_id: string
          owner_id: string
          unlocked_at: string
        }
        Insert: {
          badge_id: string
          owner_id: string
          unlocked_at?: string
        }
        Update: {
          badge_id?: string
          owner_id?: string
          unlocked_at?: string
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: []
      }
      body_weight_entries: {
        Row: {
          created_at: string
          deleted: boolean
          id: string
          measured_at: string
          owner_id: string
          revision: number
          updated_at: string
          weight_grams: number
        }
        Insert: {
          created_at?: string
          deleted?: boolean
          id?: string
          measured_at: string
          owner_id?: string
          revision?: number
          updated_at?: string
          weight_grams: number
        }
        Update: {
          created_at?: string
          deleted?: boolean
          id?: string
          measured_at?: string
          owner_id?: string
          revision?: number
          updated_at?: string
          weight_grams?: number
        }
        Relationships: []
      }
      coach_drafts: {
        Row: {
          approval_id: string | null
          approved_at: string | null
          base_program_id: string | null
          base_program_revision: number | null
          clarification: Json | null
          content: Json | null
          created_at: string
          error: Json | null
          id: string
          model: string | null
          owner_id: string
          request_id: string
          schema_version: number
          status: string
          updated_at: string
        }
        Insert: {
          approval_id?: string | null
          approved_at?: string | null
          base_program_id?: string | null
          base_program_revision?: number | null
          clarification?: Json | null
          content?: Json | null
          created_at?: string
          error?: Json | null
          id?: string
          model?: string | null
          owner_id?: string
          request_id: string
          schema_version?: number
          status?: string
          updated_at?: string
        }
        Update: {
          approval_id?: string | null
          approved_at?: string | null
          base_program_id?: string | null
          base_program_revision?: number | null
          clarification?: Json | null
          content?: Json | null
          created_at?: string
          error?: Json | null
          id?: string
          model?: string | null
          owner_id?: string
          request_id?: string
          schema_version?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_drafts_owner_id_request_id_fkey"
            columns: ["owner_id", "request_id"]
            isOneToOne: true
            referencedRelation: "coach_requests"
            referencedColumns: ["owner_id", "request_id"]
          },
        ]
      }
      coach_requests: {
        Row: {
          base_revision: number | null
          created_at: string
          input: Json
          mode: string
          owner_id: string
          program_id: string | null
          request_id: string
          status: string
          updated_at: string
        }
        Insert: {
          base_revision?: number | null
          created_at?: string
          input: Json
          mode: string
          owner_id?: string
          program_id?: string | null
          request_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          base_revision?: number | null
          created_at?: string
          input?: Json
          mode?: string
          owner_id?: string
          program_id?: string | null
          request_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          post_id: string
        }
        Insert: {
          author_id?: string
          body: string
          created_at?: string
          id?: string
          post_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_exercises: {
        Row: {
          archived: boolean
          created_at: string
          deleted: boolean
          doc: Json
          id: string
          name: string
          owner_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          archived: boolean
          created_at?: string
          deleted?: boolean
          doc: Json
          id: string
          name: string
          owner_id?: string
          revision: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          deleted?: boolean
          doc?: Json
          id?: string
          name?: string
          owner_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          requester_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          requester_id: string
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          requester_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_receipts: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          created_at: string
          op_id: string
          owner_id: string
          result: Json
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          created_at?: string
          op_id: string
          owner_id: string
          result: Json
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          created_at?: string
          op_id?: string
          owner_id?: string
          result?: Json
        }
        Relationships: []
      }
      pet_unlocks: {
        Row: {
          owner_id: string
          stage: number
          unlocked_at: string
        }
        Insert: {
          owner_id: string
          stage: number
          unlocked_at?: string
        }
        Update: {
          owner_id?: string
          stage?: number
          unlocked_at?: string
        }
        Relationships: []
      }
      posts: {
        Row: {
          author_id: string
          caption: string | null
          deleted: boolean
          id: string
          photo_path: string | null
          published_at: string
          revision: number
          snapshot: Json
          source_session_id: string | null
          updated_at: string
        }
        Insert: {
          author_id?: string
          caption?: string | null
          deleted?: boolean
          id: string
          photo_path?: string | null
          published_at?: string
          revision?: number
          snapshot: Json
          source_session_id?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          caption?: string | null
          deleted?: boolean
          id?: string
          photo_path?: string | null
          published_at?: string
          revision?: number
          snapshot?: Json
          source_session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
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
      programs: {
        Row: {
          active: boolean
          coach_draft_id: string | null
          created_at: string
          deleted: boolean
          doc: Json
          id: string
          name: string
          origin: string
          owner_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          active: boolean
          coach_draft_id?: string | null
          created_at?: string
          deleted?: boolean
          doc: Json
          id: string
          name: string
          origin: string
          owner_id?: string
          revision: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          coach_draft_id?: string | null
          created_at?: string
          deleted?: boolean
          doc?: Json
          id?: string
          name?: string
          origin?: string
          owner_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      reward_event_log: {
        Row: {
          action: string
          created_at: string
          id: number
          owner_id: string
          reward_event_id: number
          xp: number
        }
        Insert: {
          action: string
          created_at?: string
          id?: never
          owner_id: string
          reward_event_id: number
          xp: number
        }
        Update: {
          action?: string
          created_at?: string
          id?: never
          owner_id?: string
          reward_event_id?: number
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "reward_event_log_reward_event_id_fkey"
            columns: ["reward_event_id"]
            isOneToOne: false
            referencedRelation: "reward_events"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_events: {
        Row: {
          active: boolean
          created_at: string
          id: number
          owner_id: string
          reason: string
          rule_version: number
          source_id: string
          source_type: string
          updated_at: string
          xp: number
        }
        Insert: {
          active: boolean
          created_at?: string
          id?: never
          owner_id: string
          reason: string
          rule_version: number
          source_id: string
          source_type: string
          updated_at?: string
          xp: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: never
          owner_id?: string
          reason?: string
          rule_version?: number
          source_id?: string
          source_type?: string
          updated_at?: string
          xp?: number
        }
        Relationships: []
      }
      routines: {
        Row: {
          archived: boolean
          created_at: string
          deleted: boolean
          doc: Json
          id: string
          name: string
          origin: string
          owner_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          archived: boolean
          created_at?: string
          deleted?: boolean
          doc: Json
          id: string
          name: string
          origin: string
          owner_id?: string
          revision: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          deleted?: boolean
          doc?: Json
          id?: string
          name?: string
          origin?: string
          owner_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      server_change_log: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          created_at: string
          deleted: boolean
          owner_id: string
          revision: number
          seq: number
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          created_at?: string
          deleted: boolean
          owner_id: string
          revision: number
          seq: number
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          created_at?: string
          deleted?: boolean
          owner_id?: string
          revision?: number
          seq?: number
        }
        Relationships: []
      }
      sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          deleted: boolean
          doc: Json
          id: string
          local_date: string | null
          name: string
          owner_id: string
          revision: number
          routine_id: string | null
          started_at: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deleted?: boolean
          doc: Json
          id: string
          local_date?: string | null
          name: string
          owner_id?: string
          revision: number
          routine_id?: string | null
          started_at: string
          status: string
          timezone: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deleted?: boolean
          doc?: Json
          id?: string
          local_date?: string | null
          name?: string
          owner_id?: string
          revision?: number
          routine_id?: string | null
          started_at?: string
          status?: string
          timezone?: string
          updated_at?: string
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
      block_user: { Args: { p_target: string }; Returns: undefined }
      coach_begin_request: {
        Args: {
          p_base_revision: number
          p_input: Json
          p_mode: string
          p_program_id: string
          p_request_id: string
        }
        Returns: Json
      }
      coach_cancel_draft: { Args: { p_draft_id: string }; Returns: Json }
      coach_get_context: { Args: never; Returns: Json }
      coach_save_draft: {
        Args: {
          p_clarification: Json
          p_content: Json
          p_draft_id: string
          p_error: Json
          p_model: string
          p_status: string
        }
        Returns: Json
      }
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
      delete_post: { Args: { p_post_id: string }; Returns: undefined }
      follow_user: { Args: { p_target: string }; Returns: string }
      get_feed: { Args: { p_before: string; p_limit: number }; Returns: Json }
      get_profile_card: { Args: { p_handle: string }; Returns: Json }
      get_reward_rules: { Args: never; Returns: Json }
      get_reward_summary: { Args: never; Returns: Json }
      has_weekly_goal: { Args: { uid: string }; Returns: boolean }
      is_valid_timezone: { Args: { tz: string }; Returns: boolean }
      list_blocked: { Args: never; Returns: Json }
      list_follow_requests: { Args: never; Returns: Json }
      publish_post: {
        Args: {
          p_caption: string
          p_photo_path: string
          p_post_id: string
          p_session_id: string
        }
        Returns: Json
      }
      remove_follower: { Args: { p_follower: string }; Returns: undefined }
      respond_follow_request: {
        Args: { p_accept: boolean; p_requester: string }
        Returns: undefined
      }
      schedule_weekly_goal: { Args: { p_target_days: number }; Returns: string }
      search_profiles: {
        Args: { p_limit: number; p_query: string }
        Returns: Json
      }
      sync_pull: { Args: { p_after: number; p_limit: number }; Returns: Json }
      sync_push: { Args: { p_op: Json }; Returns: Json }
      unblock_user: { Args: { p_target: string }; Returns: undefined }
      unfollow_user: { Args: { p_target: string }; Returns: undefined }
      update_post_snapshot: { Args: { p_post_id: string }; Returns: Json }
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

