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
      app_user_connections: {
        Row: {
          connection_key_ciphertext: string
          connector_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_key_ciphertext: string
          connector_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_key_ciphertext?: string
          connector_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      benefit_enrollments: {
        Row: {
          created_at: string
          dependents: number
          employee_id: string
          ended_on: string | null
          enrolled_on: string
          id: string
          note: string
          plan_id: string
          status: Database["public"]["Enums"]["benefit_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          dependents?: number
          employee_id: string
          ended_on?: string | null
          enrolled_on?: string
          id?: string
          note?: string
          plan_id: string
          status?: Database["public"]["Enums"]["benefit_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          dependents?: number
          employee_id?: string
          ended_on?: string | null
          enrolled_on?: string
          id?: string
          note?: string
          plan_id?: string
          status?: Database["public"]["Enums"]["benefit_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_enrollments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_enrollments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "benefit_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_plans: {
        Row: {
          category: string
          company_id: string | null
          coverage: string
          created_at: string
          currency: string
          description: string
          employee_cost: number
          employer_cost: number
          id: string
          name: string
          provider: string
          updated_at: string
        }
        Insert: {
          category?: string
          company_id?: string | null
          coverage?: string
          created_at?: string
          currency?: string
          description?: string
          employee_cost?: number
          employer_cost?: number
          id?: string
          name: string
          provider?: string
          updated_at?: string
        }
        Update: {
          category?: string
          company_id?: string | null
          coverage?: string
          created_at?: string
          currency?: string
          description?: string
          employee_cost?: number
          employer_cost?: number
          id?: string
          name?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          applied_on: string
          created_at: string
          email: string
          full_name: string
          id: string
          job_opening_id: string
          notes: string
          phone: string
          rating: number
          resume_url: string | null
          source: string
          stage: Database["public"]["Enums"]["candidate_stage"]
          updated_at: string
        }
        Insert: {
          applied_on?: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          job_opening_id: string
          notes?: string
          phone?: string
          rating?: number
          resume_url?: string | null
          source?: string
          stage?: Database["public"]["Enums"]["candidate_stage"]
          updated_at?: string
        }
        Update: {
          applied_on?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          job_opening_id?: string
          notes?: string
          phone?: string
          rating?: number
          resume_url?: string | null
          source?: string
          stage?: Database["public"]["Enums"]["candidate_stage"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_job_opening_id_fkey"
            columns: ["job_opening_id"]
            isOneToOne: false
            referencedRelation: "job_openings"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_messages: {
        Row: {
          content: string
          created_at: string
          external_id: string | null
          id: string
          link_id: string
          role: string
        }
        Insert: {
          content?: string
          created_at?: string
          external_id?: string | null
          id?: string
          link_id: string
          role: string
        }
        Update: {
          content?: string
          created_at?: string
          external_id?: string | null
          id?: string
          link_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_messages_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "employee_channel_links"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_template_items: {
        Row: {
          created_at: string
          description: string
          id: string
          owner_role: string
          sort_order: number
          template_id: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          owner_role?: string
          sort_order?: number
          template_id: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          owner_role?: string
          sort_order?: number
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          company_id: string | null
          created_at: string
          description: string
          id: string
          kind: Database["public"]["Enums"]["checklist_kind"]
          name: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          description?: string
          id?: string
          kind?: Database["public"]["Enums"]["checklist_kind"]
          name: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          description?: string
          id?: string
          kind?: Database["public"]["Enums"]["checklist_kind"]
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          accent: string
          code: string
          created_at: string
          email_domain: string
          id: string
          is_parent: boolean
          name: string
        }
        Insert: {
          accent?: string
          code: string
          created_at?: string
          email_domain: string
          id?: string
          is_parent?: boolean
          name: string
        }
        Update: {
          accent?: string
          code?: string
          created_at?: string
          email_domain?: string
          id?: string
          is_parent?: boolean
          name?: string
        }
        Relationships: []
      }
      compliance_documents: {
        Row: {
          company_id: string
          created_at: string
          doc_type: string
          employee_id: string | null
          expires_on: string | null
          id: string
          issued_on: string | null
          name: string
          notes: string
          reference: string
          status: Database["public"]["Enums"]["compliance_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          doc_type?: string
          employee_id?: string | null
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          name: string
          notes?: string
          reference?: string
          status?: Database["public"]["Enums"]["compliance_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          doc_type?: string
          employee_id?: string | null
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          name?: string
          notes?: string
          reference?: string
          status?: Database["public"]["Enums"]["compliance_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_assets: {
        Row: {
          asset_tag: string
          asset_type: string
          assigned_on: string
          category: Database["public"]["Enums"]["asset_category"]
          company_id: string
          cost: number
          created_at: string
          currency: string
          employee_id: string
          id: string
          license_key: string
          make_model: string
          name: string
          notes: string
          quantity: number
          renewal_date: string | null
          return_due: string | null
          returned_on: string | null
          serial_number: string
          status: Database["public"]["Enums"]["asset_state"]
          updated_at: string
          vendor: string
        }
        Insert: {
          asset_tag?: string
          asset_type?: string
          assigned_on?: string
          category?: Database["public"]["Enums"]["asset_category"]
          company_id: string
          cost?: number
          created_at?: string
          currency?: string
          employee_id: string
          id?: string
          license_key?: string
          make_model?: string
          name: string
          notes?: string
          quantity?: number
          renewal_date?: string | null
          return_due?: string | null
          returned_on?: string | null
          serial_number?: string
          status?: Database["public"]["Enums"]["asset_state"]
          updated_at?: string
          vendor?: string
        }
        Update: {
          asset_tag?: string
          asset_type?: string
          assigned_on?: string
          category?: Database["public"]["Enums"]["asset_category"]
          company_id?: string
          cost?: number
          created_at?: string
          currency?: string
          employee_id?: string
          id?: string
          license_key?: string
          make_model?: string
          name?: string
          notes?: string
          quantity?: number
          renewal_date?: string | null
          return_due?: string | null
          returned_on?: string | null
          serial_number?: string
          status?: Database["public"]["Enums"]["asset_state"]
          updated_at?: string
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_assets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_assets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_channel_links: {
        Row: {
          channel: string
          code_expires_at: string | null
          connected_at: string | null
          created_at: string
          employee_id: string
          handle: string
          id: string
          last_message_at: string | null
          status: string
          updated_at: string
          verification_code: string | null
        }
        Insert: {
          channel: string
          code_expires_at?: string | null
          connected_at?: string | null
          created_at?: string
          employee_id: string
          handle?: string
          id?: string
          last_message_at?: string | null
          status?: string
          updated_at?: string
          verification_code?: string | null
        }
        Update: {
          channel?: string
          code_expires_at?: string | null
          connected_at?: string | null
          created_at?: string
          employee_id?: string
          handle?: string
          id?: string
          last_message_at?: string | null
          status?: string
          updated_at?: string
          verification_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_channel_links_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_checklist_items: {
        Row: {
          checklist_id: string
          created_at: string
          description: string
          done: boolean
          done_at: string | null
          id: string
          notes: string
          owner_role: string
          sort_order: number
          title: string
        }
        Insert: {
          checklist_id: string
          created_at?: string
          description?: string
          done?: boolean
          done_at?: string | null
          id?: string
          notes?: string
          owner_role?: string
          sort_order?: number
          title: string
        }
        Update: {
          checklist_id?: string
          created_at?: string
          description?: string
          done?: boolean
          done_at?: string | null
          id?: string
          notes?: string
          owner_role?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "employee_checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_checklists: {
        Row: {
          completed_at: string | null
          created_at: string
          due_date: string | null
          employee_id: string
          id: string
          kind: Database["public"]["Enums"]["checklist_kind"]
          name: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          employee_id: string
          id?: string
          kind?: Database["public"]["Enums"]["checklist_kind"]
          name?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          employee_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["checklist_kind"]
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_checklists_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_goals: {
        Row: {
          created_at: string
          details: string
          employee_id: string
          id: string
          progress: number
          status: Database["public"]["Enums"]["goal_status"]
          target_date: string
          title: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          details?: string
          employee_id: string
          id?: string
          progress?: number
          status?: Database["public"]["Enums"]["goal_status"]
          target_date?: string
          title: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          details?: string
          employee_id?: string
          id?: string
          progress?: number
          status?: Database["public"]["Enums"]["goal_status"]
          target_date?: string
          title?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_goals_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          access_level: Database["public"]["Enums"]["app_role"]
          band: string
          business_unit: string
          company_id: string
          created_at: string
          date_of_birth: string | null
          department: string
          email: string
          employee_code: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          exit_on: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"] | null
          hired_from: string
          home_address: string
          id: string
          job_title: string
          joined_on: string
          legal_entity: string
          location: string
          manager_id: string | null
          office_area: string
          office_city: string
          phone: string
          status: Database["public"]["Enums"]["employment_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["app_role"]
          band?: string
          business_unit?: string
          company_id: string
          created_at?: string
          date_of_birth?: string | null
          department?: string
          email: string
          employee_code?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          exit_on?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          hired_from?: string
          home_address?: string
          id?: string
          job_title?: string
          joined_on?: string
          legal_entity?: string
          location?: string
          manager_id?: string | null
          office_area?: string
          office_city?: string
          phone?: string
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_level?: Database["public"]["Enums"]["app_role"]
          band?: string
          business_unit?: string
          company_id?: string
          created_at?: string
          date_of_birth?: string | null
          department?: string
          email?: string
          employee_code?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          exit_on?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          hired_from?: string
          home_address?: string
          id?: string
          job_title?: string
          joined_on?: string
          legal_entity?: string
          location?: string
          manager_id?: string | null
          office_area?: string
          office_city?: string
          phone?: string
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_field_values: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          field: string
          id: string
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          field: string
          id?: string
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          field?: string
          id?: string
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_field_values_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_pay_settings: {
        Row: {
          allowance_percent: number
          basic_percent: number
          company_id: string
          created_at: string
          currency: string
          encash_leave_on_exit: boolean
          hra_percent: number
          id: string
          insurance_monthly: number
          notes: string
          notice_period_days: number
          other_deduction: number
          pf_percent: number
          professional_tax: number
          tax_percent: number
          updated_at: string
          working_days_per_month: number
        }
        Insert: {
          allowance_percent?: number
          basic_percent?: number
          company_id: string
          created_at?: string
          currency?: string
          encash_leave_on_exit?: boolean
          hra_percent?: number
          id?: string
          insurance_monthly?: number
          notes?: string
          notice_period_days?: number
          other_deduction?: number
          pf_percent?: number
          professional_tax?: number
          tax_percent?: number
          updated_at?: string
          working_days_per_month?: number
        }
        Update: {
          allowance_percent?: number
          basic_percent?: number
          company_id?: string
          created_at?: string
          currency?: string
          encash_leave_on_exit?: boolean
          hra_percent?: number
          id?: string
          insurance_monthly?: number
          notes?: string
          notice_period_days?: number
          other_deduction?: number
          pf_percent?: number
          professional_tax?: number
          tax_percent?: number
          updated_at?: string
          working_days_per_month?: number
        }
        Relationships: [
          {
            foreignKeyName: "entity_pay_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_claims: {
        Row: {
          company_id: string
          created_at: string
          currency: string
          destination: string
          employee_id: string
          finance_decided_at: string | null
          finance_note: string
          id: string
          notified_at: string | null
          payment_reference: string
          purpose: string
          reimbursed_amount: number
          reimbursed_on: string | null
          source: string
          status: Database["public"]["Enums"]["expense_status"]
          submitted_at: string | null
          title: string
          total_amount: number
          trip_end: string | null
          trip_start: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          currency?: string
          destination?: string
          employee_id: string
          finance_decided_at?: string | null
          finance_note?: string
          id?: string
          notified_at?: string | null
          payment_reference?: string
          purpose?: string
          reimbursed_amount?: number
          reimbursed_on?: string | null
          source?: string
          status?: Database["public"]["Enums"]["expense_status"]
          submitted_at?: string | null
          title?: string
          total_amount?: number
          trip_end?: string | null
          trip_start?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          currency?: string
          destination?: string
          employee_id?: string
          finance_decided_at?: string | null
          finance_note?: string
          id?: string
          notified_at?: string | null
          payment_reference?: string
          purpose?: string
          reimbursed_amount?: number
          reimbursed_on?: string | null
          source?: string
          status?: Database["public"]["Enums"]["expense_status"]
          submitted_at?: string | null
          title?: string
          total_amount?: number
          trip_end?: string | null
          trip_start?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_claims_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_claims_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_receipts: {
        Row: {
          amount: number
          category: string
          claim_id: string
          created_at: string
          file_name: string
          file_path: string
          file_type: string
          id: string
          merchant: string
          note: string
          spent_on: string | null
        }
        Insert: {
          amount?: number
          category?: string
          claim_id: string
          created_at?: string
          file_name?: string
          file_path?: string
          file_type?: string
          id?: string
          merchant?: string
          note?: string
          spent_on?: string | null
        }
        Update: {
          amount?: number
          category?: string
          claim_id?: string
          created_at?: string
          file_name?: string
          file_path?: string
          file_type?: string
          id?: string
          merchant?: string
          note?: string
          spent_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_receipts_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "expense_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          company_id: string | null
          created_at: string
          holiday_date: string
          id: string
          location: string
          name: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          holiday_date: string
          id?: string
          location: string
          name: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          holiday_date?: string
          id?: string
          location?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "holidays_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          candidate_id: string
          created_at: string
          feedback: string
          id: string
          interviewer: string
          mode: string
          outcome: string
          round_name: string
          scheduled_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          feedback?: string
          id?: string
          interviewer?: string
          mode?: string
          outcome?: string
          round_name?: string
          scheduled_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          feedback?: string
          id?: string
          interviewer?: string
          mode?: string
          outcome?: string
          round_name?: string
          scheduled_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      job_openings: {
        Row: {
          company_id: string
          created_at: string
          department: string
          description: string
          employment_type: string
          hiring_manager_id: string | null
          id: string
          location: string
          openings: number
          posted_on: string
          status: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          department?: string
          description?: string
          employment_type?: string
          hiring_manager_id?: string | null
          id?: string
          location?: string
          openings?: number
          posted_on?: string
          status?: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          department?: string
          description?: string
          employment_type?: string
          hiring_manager_id?: string | null
          id?: string
          location?: string
          openings?: number
          posted_on?: string
          status?: Database["public"]["Enums"]["job_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_openings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_openings_hiring_manager_id_fkey"
            columns: ["hiring_manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_balances: {
        Row: {
          employee_id: string
          entitled_days: number
          id: string
          leave_type_id: string
          used_days: number
          year: number
        }
        Insert: {
          employee_id: string
          entitled_days?: number
          id?: string
          leave_type_id: string
          used_days?: number
          year?: number
        }
        Update: {
          employee_id?: string
          entitled_days?: number
          id?: string
          leave_type_id?: string
          used_days?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_balances_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          days: number
          decided_at: string | null
          decision_note: string | null
          employee_id: string
          end_date: string
          id: string
          leave_type_id: string
          reason: string
          start_date: string
          status: Database["public"]["Enums"]["request_status"]
        }
        Insert: {
          created_at?: string
          days?: number
          decided_at?: string | null
          decision_note?: string | null
          employee_id: string
          end_date: string
          id?: string
          leave_type_id: string
          reason?: string
          start_date: string
          status?: Database["public"]["Enums"]["request_status"]
        }
        Update: {
          created_at?: string
          days?: number
          decided_at?: string | null
          decision_note?: string | null
          employee_id?: string
          end_date?: string
          id?: string
          leave_type_id?: string
          reason?: string
          start_date?: string
          status?: Database["public"]["Enums"]["request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          annual_days: number
          carry_forward_days: number
          code: string
          created_at: string
          description: string
          id: string
          name: string
        }
        Insert: {
          annual_days?: number
          carry_forward_days?: number
          code: string
          created_at?: string
          description?: string
          id?: string
          name: string
        }
        Update: {
          annual_days?: number
          carry_forward_days?: number
          code?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      password_reset_attempts: {
        Row: {
          created_at: string
          email: string
          last_sent_at: string
          sent_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          last_sent_at?: string
          sent_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          last_sent_at?: string
          sent_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      payroll_runs: {
        Row: {
          company_id: string
          created_at: string
          id: string
          note: string
          period_month: string
          processed_at: string | null
          status: Database["public"]["Enums"]["payroll_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          note?: string
          period_month: string
          processed_at?: string | null
          status?: Database["public"]["Enums"]["payroll_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          note?: string
          period_month?: string
          processed_at?: string | null
          status?: Database["public"]["Enums"]["payroll_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          created_at: string
          currency: string
          deductions: number
          employee_id: string
          finance_decided_at: string | null
          finance_note: string
          finance_status: Database["public"]["Enums"]["request_status"]
          gross_pay: number
          hr_decided_at: string | null
          hr_note: string
          hr_status: Database["public"]["Enums"]["request_status"]
          id: string
          loss_of_pay_days: number
          net_pay: number
          paid_amount: number
          paid_days: number
          paid_on: string | null
          payment_reference: string
          payroll_run_id: string | null
          period_month: string
          status: Database["public"]["Enums"]["payroll_status"]
          tax: number
        }
        Insert: {
          created_at?: string
          currency?: string
          deductions?: number
          employee_id: string
          finance_decided_at?: string | null
          finance_note?: string
          finance_status?: Database["public"]["Enums"]["request_status"]
          gross_pay?: number
          hr_decided_at?: string | null
          hr_note?: string
          hr_status?: Database["public"]["Enums"]["request_status"]
          id?: string
          loss_of_pay_days?: number
          net_pay?: number
          paid_amount?: number
          paid_days?: number
          paid_on?: string | null
          payment_reference?: string
          payroll_run_id?: string | null
          period_month: string
          status?: Database["public"]["Enums"]["payroll_status"]
          tax?: number
        }
        Update: {
          created_at?: string
          currency?: string
          deductions?: number
          employee_id?: string
          finance_decided_at?: string | null
          finance_note?: string
          finance_status?: Database["public"]["Enums"]["request_status"]
          gross_pay?: number
          hr_decided_at?: string | null
          hr_note?: string
          hr_status?: Database["public"]["Enums"]["request_status"]
          id?: string
          loss_of_pay_days?: number
          net_pay?: number
          paid_amount?: number
          paid_days?: number
          paid_on?: string | null
          payment_reference?: string
          payroll_run_id?: string | null
          period_month?: string
          status?: Database["public"]["Enums"]["payroll_status"]
          tax?: number
        }
        Relationships: [
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_reviews: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          improvements: string
          period: string
          rating: number
          review_date: string
          status: Database["public"]["Enums"]["review_status"]
          strengths: string
          summary: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          improvements?: string
          period: string
          rating?: number
          review_date?: string
          status?: Database["public"]["Enums"]["review_status"]
          strengths?: string
          summary?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          improvements?: string
          period?: string
          rating?: number
          review_date?: string
          status?: Database["public"]["Enums"]["review_status"]
          strengths?: string
          summary?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_reviews_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          body: string
          category: string
          company_id: string | null
          created_at: string
          effective_from: string
          id: string
          title: string
        }
        Insert: {
          body: string
          category?: string
          company_id?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          title: string
        }
        Update: {
          body?: string
          category?: string
          company_id?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      protectra_staging: {
        Row: {
          band: string
          date_of_birth: string | null
          email: string
          employee_code: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          exit_on: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"]
          hired_from: string
          job_title: string
          joined_on: string
          legal_entity: string
          manager_name: string
          office_city: string
          status: Database["public"]["Enums"]["employment_status"]
        }
        Insert: {
          band: string
          date_of_birth?: string | null
          email: string
          employee_code: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          exit_on?: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"]
          hired_from: string
          job_title: string
          joined_on: string
          legal_entity: string
          manager_name: string
          office_city: string
          status: Database["public"]["Enums"]["employment_status"]
        }
        Update: {
          band?: string
          date_of_birth?: string | null
          email?: string
          employee_code?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          exit_on?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"]
          hired_from?: string
          job_title?: string
          joined_on?: string
          legal_entity?: string
          manager_name?: string
          office_city?: string
          status?: Database["public"]["Enums"]["employment_status"]
        }
        Relationships: []
      }
      salary_structures: {
        Row: {
          annual_ctc: number
          created_at: string
          currency: string
          effective_from: string
          employee_id: string
          id: string
          monthly_allowances: number
          monthly_basic: number
          monthly_deductions: number
          monthly_hra: number
          tax_percent: number
          updated_at: string
        }
        Insert: {
          annual_ctc?: number
          created_at?: string
          currency?: string
          effective_from?: string
          employee_id: string
          id?: string
          monthly_allowances?: number
          monthly_basic?: number
          monthly_deductions?: number
          monthly_hra?: number
          tax_percent?: number
          updated_at?: string
        }
        Update: {
          annual_ctc?: number
          created_at?: string
          currency?: string
          effective_from?: string
          employee_id?: string
          id?: string
          monthly_allowances?: number
          monthly_basic?: number
          monthly_deductions?: number
          monthly_hra?: number
          tax_percent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_structures_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      separation_requests: {
        Row: {
          approved_last_day: string | null
          created_at: string
          employee_id: string
          exit_interview_done: boolean
          expense_reimbursement_amount: number
          final_salary_amount: number
          finance_decided_at: string | null
          finance_note: string
          finance_routed_at: string | null
          finance_status: Database["public"]["Enums"]["request_status"]
          handover_to: string | null
          hr_decided_at: string | null
          hr_note: string
          hr_status: Database["public"]["Enums"]["request_status"]
          id: string
          it_assets: string
          it_decided_at: string | null
          it_note: string
          it_status: Database["public"]["Enums"]["request_status"]
          leave_encashment_amount: number
          leave_encashment_days: number
          manager_decided_at: string | null
          manager_note: string
          manager_status: Database["public"]["Enums"]["request_status"]
          notice_date: string
          notice_days: number
          reason: string
          requested_last_day: string
          resignation_type: string
          settlement_amount: number
          settlement_paid_on: string | null
          stage: Database["public"]["Enums"]["separation_stage"]
          unpaid_leave_amount: number
          unpaid_leave_days: number
          updated_at: string
        }
        Insert: {
          approved_last_day?: string | null
          created_at?: string
          employee_id: string
          exit_interview_done?: boolean
          expense_reimbursement_amount?: number
          final_salary_amount?: number
          finance_decided_at?: string | null
          finance_note?: string
          finance_routed_at?: string | null
          finance_status?: Database["public"]["Enums"]["request_status"]
          handover_to?: string | null
          hr_decided_at?: string | null
          hr_note?: string
          hr_status?: Database["public"]["Enums"]["request_status"]
          id?: string
          it_assets?: string
          it_decided_at?: string | null
          it_note?: string
          it_status?: Database["public"]["Enums"]["request_status"]
          leave_encashment_amount?: number
          leave_encashment_days?: number
          manager_decided_at?: string | null
          manager_note?: string
          manager_status?: Database["public"]["Enums"]["request_status"]
          notice_date?: string
          notice_days?: number
          reason?: string
          requested_last_day: string
          resignation_type?: string
          settlement_amount?: number
          settlement_paid_on?: string | null
          stage?: Database["public"]["Enums"]["separation_stage"]
          unpaid_leave_amount?: number
          unpaid_leave_days?: number
          updated_at?: string
        }
        Update: {
          approved_last_day?: string | null
          created_at?: string
          employee_id?: string
          exit_interview_done?: boolean
          expense_reimbursement_amount?: number
          final_salary_amount?: number
          finance_decided_at?: string | null
          finance_note?: string
          finance_routed_at?: string | null
          finance_status?: Database["public"]["Enums"]["request_status"]
          handover_to?: string | null
          hr_decided_at?: string | null
          hr_note?: string
          hr_status?: Database["public"]["Enums"]["request_status"]
          id?: string
          it_assets?: string
          it_decided_at?: string | null
          it_note?: string
          it_status?: Database["public"]["Enums"]["request_status"]
          leave_encashment_amount?: number
          leave_encashment_days?: number
          manager_decided_at?: string | null
          manager_note?: string
          manager_status?: Database["public"]["Enums"]["request_status"]
          notice_date?: string
          notice_days?: number
          reason?: string
          requested_last_day?: string
          resignation_type?: string
          settlement_amount?: number
          settlement_paid_on?: string | null
          stage?: Database["public"]["Enums"]["separation_stage"]
          unpaid_leave_amount?: number
          unpaid_leave_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "separation_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "separation_requests_handover_to_fkey"
            columns: ["handover_to"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      subsidiary_requests: {
        Row: {
          company_code: string
          company_name: string
          created_at: string
          decided_at: string | null
          decision_note: string | null
          email: string
          email_domain: string
          full_name: string
          id: string
          note: string
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
        }
        Insert: {
          company_code: string
          company_name: string
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          email: string
          email_domain: string
          full_name: string
          id?: string
          note?: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
        }
        Update: {
          company_code?: string
          company_name?: string
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          email?: string
          email_domain?: string
          full_name?: string
          id?: string
          note?: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
        }
        Relationships: []
      }
      timesheet_entries: {
        Row: {
          hours: number
          id: string
          notes: string
          project: string
          timesheet_id: string
          work_date: string
        }
        Insert: {
          hours?: number
          id?: string
          notes?: string
          project?: string
          timesheet_id: string
          work_date: string
        }
        Update: {
          hours?: number
          id?: string
          notes?: string
          project?: string
          timesheet_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          created_at: string
          decided_at: string | null
          employee_id: string
          finance_decided_at: string | null
          finance_note: string
          finance_status: Database["public"]["Enums"]["request_status"]
          id: string
          note: string
          status: Database["public"]["Enums"]["timesheet_status"]
          submitted_at: string | null
          total_hours: number
          week_start: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          employee_id: string
          finance_decided_at?: string | null
          finance_note?: string
          finance_status?: Database["public"]["Enums"]["request_status"]
          id?: string
          note?: string
          status?: Database["public"]["Enums"]["timesheet_status"]
          submitted_at?: string | null
          total_hours?: number
          week_start: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          employee_id?: string
          finance_decided_at?: string | null
          finance_note?: string
          finance_status?: Database["public"]["Enums"]["request_status"]
          id?: string
          note?: string
          status?: Database["public"]["Enums"]["timesheet_status"]
          submitted_at?: string | null
          total_hours?: number
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      training_courses: {
        Row: {
          category: string
          company_id: string | null
          created_at: string
          description: string
          hours: number
          id: string
          mandatory: boolean
          provider: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          company_id?: string | null
          created_at?: string
          description?: string
          hours?: number
          id?: string
          mandatory?: boolean
          provider?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          company_id?: string | null
          created_at?: string
          description?: string
          hours?: number
          id?: string
          mandatory?: boolean
          provider?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_courses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      training_enrollments: {
        Row: {
          completed_on: string | null
          course_id: string
          created_at: string
          due_date: string | null
          employee_id: string
          id: string
          progress: number
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
        }
        Insert: {
          completed_on?: string | null
          course_id: string
          created_at?: string
          due_date?: string | null
          employee_id: string
          id?: string
          progress?: number
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Update: {
          completed_on?: string | null
          course_id?: string
          created_at?: string
          due_date?: string | null
          employee_id?: string
          id?: string
          progress?: number
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "training_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_enrollments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_my_employee_record: { Args: never; Returns: string }
      my_reporting_chain: {
        Args: never
        Returns: {
          department: string
          depth: number
          email: string
          full_name: string
          id: string
          job_title: string
        }[]
      }
      update_my_contact: {
        Args: { _home_address: string; _phone: string }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "master_hr"
        | "company_hr"
        | "employee"
        | "finance_expense"
        | "finance_payroll"
        | "it_asset"
      asset_category:
        | "hardware"
        | "accessory"
        | "software_license"
        | "subscription"
        | "other"
      asset_state: "assigned" | "returned" | "lost" | "damaged" | "retired"
      benefit_status: "pending" | "active" | "ended"
      candidate_stage:
        | "applied"
        | "screening"
        | "interview"
        | "offer"
        | "hired"
        | "rejected"
      checklist_kind: "onboarding" | "offboarding"
      compliance_status: "valid" | "expiring" | "expired" | "missing"
      employment_status: "onboarding" | "active" | "on_leave" | "offboarded"
      employment_type: "full_time" | "part_time" | "consultant" | "intern"
      enrollment_status: "enrolled" | "in_progress" | "completed" | "dropped"
      expense_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "reimbursed"
      gender_type: "male" | "female" | "undisclosed"
      goal_status: "draft" | "active" | "achieved" | "missed"
      job_status: "open" | "on_hold" | "closed"
      payroll_status: "draft" | "processed" | "paid"
      request_status: "pending" | "approved" | "rejected" | "cancelled"
      review_status: "draft" | "shared"
      separation_stage:
        | "submitted"
        | "hr_review"
        | "it_clearance"
        | "finance_settlement"
        | "completed"
        | "withdrawn"
        | "rejected"
        | "manager_review"
      timesheet_status: "draft" | "submitted" | "approved" | "rejected"
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
      app_role: [
        "master_hr",
        "company_hr",
        "employee",
        "finance_expense",
        "finance_payroll",
        "it_asset",
      ],
      asset_category: [
        "hardware",
        "accessory",
        "software_license",
        "subscription",
        "other",
      ],
      asset_state: ["assigned", "returned", "lost", "damaged", "retired"],
      benefit_status: ["pending", "active", "ended"],
      candidate_stage: [
        "applied",
        "screening",
        "interview",
        "offer",
        "hired",
        "rejected",
      ],
      checklist_kind: ["onboarding", "offboarding"],
      compliance_status: ["valid", "expiring", "expired", "missing"],
      employment_status: ["onboarding", "active", "on_leave", "offboarded"],
      employment_type: ["full_time", "part_time", "consultant", "intern"],
      enrollment_status: ["enrolled", "in_progress", "completed", "dropped"],
      expense_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "reimbursed",
      ],
      gender_type: ["male", "female", "undisclosed"],
      goal_status: ["draft", "active", "achieved", "missed"],
      job_status: ["open", "on_hold", "closed"],
      payroll_status: ["draft", "processed", "paid"],
      request_status: ["pending", "approved", "rejected", "cancelled"],
      review_status: ["draft", "shared"],
      separation_stage: [
        "submitted",
        "hr_review",
        "it_clearance",
        "finance_settlement",
        "completed",
        "withdrawn",
        "rejected",
        "manager_review",
      ],
      timesheet_status: ["draft", "submitted", "approved", "rejected"],
    },
  },
} as const
