// Hand-maintained to mirror supabase/migrations/20260625235806_init_schema.sql
// (the canonical schema). Regenerate with `supabase gen types typescript`
// once the Supabase CLI is wired up; until then keep this in sync by hand.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      businesses: {
        Row: {
          id: string
          name: string
          contact_email: string | null
          contact_phone: string | null
          reward_threshold: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          contact_email?: string | null
          contact_phone?: string | null
          reward_threshold?: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          contact_email?: string | null
          contact_phone?: string | null
          reward_threshold?: number
          created_at?: string
        }
        Relationships: []
      }
      staff_users: {
        Row: {
          id: string
          business_id: string
          auth_user_id: string
          name: string | null
          created_at: string
        }
        Insert: {
          id?: string
          business_id: string
          auth_user_id: string
          name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          auth_user_id?: string
          name?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          id: string
          device_token: string | null
          phone_number: string | null
          email: string | null
          auth_user_id: string | null
          claimed_at: string | null
          signup_source: Database["public"]["Enums"]["signup_source"] | null
          created_at: string
        }
        Insert: {
          id?: string
          device_token?: string | null
          phone_number?: string | null
          email?: string | null
          auth_user_id?: string | null
          claimed_at?: string | null
          signup_source?: Database["public"]["Enums"]["signup_source"] | null
          created_at?: string
        }
        Update: {
          id?: string
          device_token?: string | null
          phone_number?: string | null
          email?: string | null
          auth_user_id?: string | null
          claimed_at?: string | null
          signup_source?: Database["public"]["Enums"]["signup_source"] | null
          created_at?: string
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          id: string
          customer_id: string
          business_id: string
          current_stamps: number
          created_at: string
        }
        Insert: {
          id?: string
          customer_id: string
          business_id: string
          current_stamps?: number
          created_at?: string
        }
        Update: {
          id?: string
          customer_id?: string
          business_id?: string
          current_stamps?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          id: string
          business_id: string
          customer_id: string | null
          qr_token: string
          amount: number | null
          status: Database["public"]["Enums"]["transaction_status"]
          expires_at: string
          created_at: string
          scanned_at: string | null
        }
        Insert: {
          id?: string
          business_id: string
          customer_id?: string | null
          qr_token: string
          amount?: number | null
          status?: Database["public"]["Enums"]["transaction_status"]
          expires_at: string
          created_at?: string
          scanned_at?: string | null
        }
        Update: {
          id?: string
          business_id?: string
          customer_id?: string | null
          qr_token?: string
          amount?: number | null
          status?: Database["public"]["Enums"]["transaction_status"]
          expires_at?: string
          created_at?: string
          scanned_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      redemptions: {
        Row: {
          id: string
          enrollment_id: string
          redemption_code: string
          status: Database["public"]["Enums"]["redemption_status"]
          created_at: string
          verified_at: string | null
          expires_at: string | null
        }
        Insert: {
          id?: string
          enrollment_id: string
          redemption_code: string
          status?: Database["public"]["Enums"]["redemption_status"]
          created_at?: string
          verified_at?: string | null
          expires_at?: string | null
        }
        Update: {
          id?: string
          enrollment_id?: string
          redemption_code?: string
          status?: Database["public"]["Enums"]["redemption_status"]
          created_at?: string
          verified_at?: string | null
          expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "redemptions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      scan_transaction: {
        Args: {
          p_qr_token: string
          p_auth_user_id?: string | null
          p_device_token?: string | null
        }
        Returns: Json
      }
      create_redemption: {
        Args: {
          p_enrollment_id: string
          p_customer_id: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      verify_redemption: {
        Args: {
          p_code: string
          p_staff_auth_user_id?: string | null
        }
        Returns: Json
      }
    }
    Enums: {
      signup_source: "qr_scan" | "direct_signup" | "business_referral"
      transaction_status: "pending" | "scanned" | "expired"
      redemption_status: "pending" | "verified"
    }
    CompositeTypes: Record<string, never>
  }
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"]

export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T]
