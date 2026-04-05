export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          wallet_address: string | null;
          kite_passport_agent_id: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          wallet_address?: string | null;
          kite_passport_agent_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          wallet_address?: string | null;
          kite_passport_agent_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      agents: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          aa_wallet_address: string | null;
          vault_proxy_address: string | null;
          status: "active" | "inactive" | "paused" | "error";
          strategy_id: string | null;
          config: Json;
          spending_rules: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          aa_wallet_address?: string | null;
          vault_proxy_address?: string | null;
          status?: "active" | "inactive" | "paused" | "error";
          strategy_id?: string | null;
          config?: Json;
          spending_rules?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          aa_wallet_address?: string | null;
          vault_proxy_address?: string | null;
          status?: "active" | "inactive" | "paused" | "error";
          strategy_id?: string | null;
          config?: Json;
          spending_rules?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      strategies: {
        Row: {
          id: string;
          user_id: string | null;
          name: string;
          description: string | null;
          type: "rebalance" | "yield_optimize" | "dca" | "momentum" | "custom";
          rules: Json;
          is_template: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          name: string;
          description?: string | null;
          type: "rebalance" | "yield_optimize" | "dca" | "momentum" | "custom";
          rules: Json;
          is_template?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          name?: string;
          description?: string | null;
          type?: "rebalance" | "yield_optimize" | "dca" | "momentum" | "custom";
          rules?: Json;
          is_template?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      execution_logs: {
        Row: {
          id: string;
          agent_id: string;
          action_type: string;
          description: string | null;
          input_data: Json | null;
          decision: Json | null;
          tx_hash: string | null;
          attestation_tx_hash: string | null;
          status: "pending" | "executing" | "success" | "failed";
          gas_used: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          agent_id: string;
          action_type: string;
          description?: string | null;
          input_data?: Json | null;
          decision?: Json | null;
          tx_hash?: string | null;
          attestation_tx_hash?: string | null;
          status?: "pending" | "executing" | "success" | "failed";
          gas_used?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          agent_id?: string;
          action_type?: string;
          description?: string | null;
          input_data?: Json | null;
          decision?: Json | null;
          tx_hash?: string | null;
          attestation_tx_hash?: string | null;
          status?: "pending" | "executing" | "success" | "failed";
          gas_used?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      portfolio_snapshots: {
        Row: {
          id: string;
          agent_id: string;
          total_value_usd: number | null;
          holdings: Json | null;
          snapshot_at: string;
        };
        Insert: {
          id?: string;
          agent_id: string;
          total_value_usd?: number | null;
          holdings?: Json | null;
          snapshot_at?: string;
        };
        Update: {
          id?: string;
          agent_id?: string;
          total_value_usd?: number | null;
          holdings?: Json | null;
          snapshot_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

// Convenience types
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Agent = Database["public"]["Tables"]["agents"]["Row"];
export type Strategy = Database["public"]["Tables"]["strategies"]["Row"];
export type ExecutionLog = Database["public"]["Tables"]["execution_logs"]["Row"];
export type PortfolioSnapshot = Database["public"]["Tables"]["portfolio_snapshots"]["Row"];

export type AgentInsert = Database["public"]["Tables"]["agents"]["Insert"];
export type StrategyInsert = Database["public"]["Tables"]["strategies"]["Insert"];
