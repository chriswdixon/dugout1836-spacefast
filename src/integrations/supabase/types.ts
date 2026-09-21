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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      album_photos: {
        Row: {
          ai_scanned_at: string | null
          album_id: string
          created_at: string
          created_time: string | null
          drive_file_id: string
          event_id: string | null
          height: number | null
          id: string
          mime_type: string | null
          name: string | null
          storage_path: string | null
          thumbnail_url: string | null
          width: number | null
        }
        Insert: {
          ai_scanned_at?: string | null
          album_id: string
          created_at?: string
          created_time?: string | null
          drive_file_id: string
          event_id?: string | null
          height?: number | null
          id?: string
          mime_type?: string | null
          name?: string | null
          storage_path?: string | null
          thumbnail_url?: string | null
          width?: number | null
        }
        Update: {
          ai_scanned_at?: string | null
          album_id?: string
          created_at?: string
          created_time?: string | null
          drive_file_id?: string
          event_id?: string | null
          height?: number | null
          id?: string
          mime_type?: string | null
          name?: string | null
          storage_path?: string | null
          thumbnail_url?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "album_photos_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_photos_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      albums: {
        Row: {
          cover_url: string | null
          created_at: string
          description: string | null
          drive_folder_id: string | null
          event_id: string | null
          gphotos_url: string | null
          id: string
          last_synced_at: string | null
          photo_count: number
          season: string | null
          sort_order: number
          title: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          drive_folder_id?: string | null
          event_id?: string | null
          gphotos_url?: string | null
          id?: string
          last_synced_at?: string | null
          photo_count?: number
          season?: string | null
          sort_order?: number
          title: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          drive_folder_id?: string | null
          event_id?: string | null
          gphotos_url?: string | null
          id?: string
          last_synced_at?: string | null
          photo_count?: number
          season?: string | null
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "albums_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          author_id: string
          author_name: string | null
          body: string
          created_at: string
          id: string
        }
        Insert: {
          author_id: string
          author_name?: string | null
          body: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          created_at: string
          event_name: string | null
          event_type: string
          external_id: string | null
          id: string
          link_url: string | null
          location: string | null
          notes: string | null
          opponent: string | null
          recap: string | null
          result: string | null
          score_them: number | null
          score_us: number | null
          source: Database["public"]["Enums"]["data_source"]
          starts_at: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_name?: string | null
          event_type?: string
          external_id?: string | null
          id?: string
          link_url?: string | null
          location?: string | null
          notes?: string | null
          opponent?: string | null
          recap?: string | null
          result?: string | null
          score_them?: number | null
          score_us?: number | null
          source?: Database["public"]["Enums"]["data_source"]
          starts_at: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_name?: string | null
          event_type?: string
          external_id?: string | null
          id?: string
          link_url?: string | null
          location?: string | null
          notes?: string | null
          opponent?: string | null
          recap?: string | null
          result?: string | null
          score_them?: number | null
          score_us?: number | null
          source?: Database["public"]["Enums"]["data_source"]
          starts_at?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      invites: {
        Row: {
          accepted_at: string | null
          auto_approve: boolean
          code: string | null
          created_at: string
          email: string | null
          id: string
          invited_by: string | null
          label: string | null
        }
        Insert: {
          accepted_at?: string | null
          auto_approve?: boolean
          code?: string | null
          created_at?: string
          email?: string | null
          id?: string
          invited_by?: string | null
          label?: string | null
        }
        Update: {
          accepted_at?: string | null
          auto_approve?: boolean
          code?: string | null
          created_at?: string
          email?: string | null
          id?: string
          invited_by?: string | null
          label?: string | null
        }
        Relationships: []
      }
      media_items: {
        Row: {
          created_at: string
          description: string | null
          event_id: string | null
          external_id: string | null
          id: string
          kind: string
          media_url: string
          mime_type: string | null
          published_at: string | null
          source: Database["public"]["Enums"]["data_source"]
          storage_path: string | null
          submitted_by: string | null
          thumbnail_url: string | null
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_id?: string | null
          external_id?: string | null
          id?: string
          kind?: string
          media_url: string
          mime_type?: string | null
          published_at?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          storage_path?: string | null
          submitted_by?: string | null
          thumbnail_url?: string | null
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          event_id?: string | null
          external_id?: string | null
          id?: string
          kind?: string
          media_url?: string
          mime_type?: string | null
          published_at?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          storage_path?: string | null
          submitted_by?: string | null
          thumbnail_url?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_items_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_tags: {
        Row: {
          album_photo_id: string | null
          confidence: number | null
          created_at: string
          created_by: string | null
          id: string
          jersey_number: string | null
          method: string
          photo_upload_id: string | null
          player_id: string
          updated_at: string
        }
        Insert: {
          album_photo_id?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          jersey_number?: string | null
          method?: string
          photo_upload_id?: string | null
          player_id: string
          updated_at?: string
        }
        Update: {
          album_photo_id?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          jersey_number?: string | null
          method?: string
          photo_upload_id?: string | null
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_tags_album_photo_id_fkey"
            columns: ["album_photo_id"]
            isOneToOne: false
            referencedRelation: "album_photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_tags_photo_upload_id_fkey"
            columns: ["photo_upload_id"]
            isOneToOne: false
            referencedRelation: "photo_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_tags_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_uploads: {
        Row: {
          ai_scanned_at: string | null
          album_id: string | null
          caption: string | null
          created_at: string
          event_id: string | null
          height: number | null
          id: string
          mime_type: string | null
          storage_path: string
          uploaded_by: string
          width: number | null
        }
        Insert: {
          ai_scanned_at?: string | null
          album_id?: string | null
          caption?: string | null
          created_at?: string
          event_id?: string | null
          height?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          uploaded_by: string
          width?: number | null
        }
        Update: {
          ai_scanned_at?: string | null
          album_id?: string | null
          caption?: string | null
          created_at?: string
          event_id?: string | null
          height?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          uploaded_by?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photo_uploads_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_uploads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      player_stats: {
        Row: {
          category: string
          created_at: string
          event_id: string | null
          external_id: string | null
          id: string
          player_id: string | null
          player_name: string | null
          season: string
          source: Database["public"]["Enums"]["data_source"]
          stats: Json
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          event_id?: string | null
          external_id?: string | null
          id?: string
          player_id?: string | null
          player_name?: string | null
          season?: string
          source?: Database["public"]["Enums"]["data_source"]
          stats?: Json
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          event_id?: string | null
          external_id?: string | null
          id?: string
          player_id?: string | null
          player_name?: string | null
          season?: string
          source?: Database["public"]["Enums"]["data_source"]
          stats?: Json
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_stats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          bats: string | null
          created_at: string
          external_id: string | null
          grad_year: number | null
          id: string
          jersey_number: string | null
          name: string
          photo_url: string | null
          positions: string | null
          sort_order: number
          source: Database["public"]["Enums"]["data_source"]
          throws: string | null
          updated_at: string
        }
        Insert: {
          bats?: string | null
          created_at?: string
          external_id?: string | null
          grad_year?: number | null
          id?: string
          jersey_number?: string | null
          name: string
          photo_url?: string | null
          positions?: string | null
          sort_order?: number
          source?: Database["public"]["Enums"]["data_source"]
          throws?: string | null
          updated_at?: string
        }
        Update: {
          bats?: string | null
          created_at?: string
          external_id?: string | null
          grad_year?: number | null
          id?: string
          jersey_number?: string | null
          name?: string
          photo_url?: string | null
          positions?: string | null
          sort_order?: number
          source?: Database["public"]["Enums"]["data_source"]
          throws?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          invited_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          invited_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          invited_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      source_configs: {
        Row: {
          enabled: boolean
          extra_urls: string[] | null
          id: string
          last_run_at: string | null
          notes: string | null
          source: Database["public"]["Enums"]["data_source"]
          team_name: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          enabled?: boolean
          extra_urls?: string[] | null
          id?: string
          last_run_at?: string | null
          notes?: string | null
          source: Database["public"]["Enums"]["data_source"]
          team_name?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          enabled?: boolean
          extra_urls?: string[] | null
          id?: string
          last_run_at?: string | null
          notes?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          team_name?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      staged_records: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json
          source: Database["public"]["Enums"]["data_source"]
          status: string
          sync_run_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload: Json
          source: Database["public"]["Enums"]["data_source"]
          status?: string
          sync_run_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          source?: Database["public"]["Enums"]["data_source"]
          status?: string
          sync_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staged_records_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          finished_at: string | null
          id: string
          items_found: number
          message: string | null
          source: Database["public"]["Enums"]["data_source"]
          started_at: string
          status: string
        }
        Insert: {
          finished_at?: string | null
          id?: string
          items_found?: number
          message?: string | null
          source: Database["public"]["Enums"]["data_source"]
          started_at?: string
          status?: string
        }
        Update: {
          finished_at?: string | null
          id?: string
          items_found?: number
          message?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      team_stats: {
        Row: {
          category: string
          created_at: string
          event_id: string | null
          id: string
          season: string
          source: Database["public"]["Enums"]["data_source"]
          stats: Json
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          event_id?: string | null
          id?: string
          season?: string
          source?: Database["public"]["Enums"]["data_source"]
          stats?: Json
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          event_id?: string | null
          id?: string
          season?: string
          source?: Database["public"]["Enums"]["data_source"]
          stats?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_stats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_member: { Args: { _user_id: string }; Returns: boolean }
      my_status: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "admin" | "parent"
      data_source:
        | "manual"
        | "gamechanger"
        | "fivetools"
        | "perfect_game"
        | "google_drive"
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
      app_role: ["admin", "parent"],
      data_source: [
        "manual",
        "gamechanger",
        "fivetools",
        "perfect_game",
        "google_drive",
      ],
    },
  },
} as const
