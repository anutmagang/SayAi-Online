export type JobRow = {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  job_type?: "clipper" | "image_gen" | "video_gen" | null;
  source_url: string;
  created_at: string;
  updated_at?: string;
  finished_at?: string | null;
  tier_used?: "free" | "starter" | "creator" | "pro" | null;
  source_kind?: "url" | "upload" | "ai_image" | "ai_video" | null;
};

export type ProfileRow = {
  user_id: string;
  tier: "free" | "starter" | "creator" | "pro";
  credits_balance: number;
  is_admin: boolean;
  monthly_quota: number;
  monthly_used: number;
  monthly_reset_at: string;
  plan_expires_at: string | null;
  llm_preference: "auto" | "groq" | "gemini" | "openai" | "anthropic";
  llm_model_id?: string | null;
  watermark_paid_enabled?: boolean;
  watermark_custom_text?: string | null;
  watermark_position?: string;
  password_change_failures?: number;
  password_change_lockout_until?: string | null;
  /** Izinkan operator melihat log job untuk bantuan teknis (pilihan user). */
  support_logs_opt_in?: boolean;
  /** Terakhir unggah cookies.txt YouTube (job URL memakai cookie per user). */
  youtube_cookies_uploaded_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type TopupRequestRow = {
  id: string;
  user_id: string;
  credits_requested: number;
  payment_note: string;
  bank_reference: string | null;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionRequestRow = {
  id: string;
  user_id: string;
  requested_tier: "starter" | "creator" | "pro";
  months: number;
  payment_note: string;
  bank_reference: string | null;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobEventRow = {
  id: number;
  job_id: string;
  user_id: string;
  phase: string;
  message: string | null;
  progress: number | null;
  created_at: string;
};

export type ClipMeta = {
  start_sec: number;
  end_sec: number;
  label: string;
  /** Deskripsi siap tempel (TikTok/Reels/Shorts). */
  post_caption?: string;
  /** Tag dipisah spasi, mis. "#tips #podcast". */
  hashtags?: string;
  /** short_vertical = 9:16; long_horizontal = 16:9 (job baru). */
  output_layout?: "short_vertical" | "long_horizontal";
  vertical_9_16: boolean;
  output_px: [number, number] | null;
  caption_word_count: number;
  viral_score: number;
  watermarked?: boolean;
  storage_path?: string;
};

export type JobResult = {
  job_type?: "clipper" | "image_gen" | "video_gen";
  /** Diminta user / plafon job (clipper). */
  clips_requested?: number;
  /** Jumlah klip setelah LLM + dedupe (bisa < diminta). */
  clips_delivered?: number;
  /** Target tampilan skor viral (heuristik), bukan filter keras. */
  viral_score_target_min?: number;
  source_url: string;
  source_file: string;
  duration_sec: number;
  user_tier?: "free" | "starter" | "creator" | "pro";
  llm_provider_used?: string;
  llm_model_used?: string;
  transcribe_provider_used?: string;
  phase3?: {
    output_layout?: "short_vertical" | "long_horizontal";
    vertical_enabled: boolean;
    vertical_px: [number, number] | null;
    horizontal_px?: [number, number] | null;
    /** Subtitle/karaoke terbakar di piksel video (PHASE3_BURN_CAPTIONS). */
    burn_captions?: boolean;
    word_timestamps: boolean;
    watermark_text?: string;
  };
  phase4?: { viral_model?: string; viral_score_range?: [number, number] };
  ai?: {
    prompt?: string;
    model?: string;
    aspect_ratio?: "1:1" | "9:16" | "16:9" | "4:3" | "3:4";
    duration_sec?: number;
  };
  generations?: Array<{
    kind: "image" | "video";
    mime: string;
    storage_path: string;
    width?: number;
    height?: number;
    duration_sec?: number;
  }>;
  clips: ClipMeta[];
};

