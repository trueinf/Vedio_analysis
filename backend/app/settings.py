from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AI Video Performance Analyzer"
    api_base_url: str = "http://localhost:8000"
    cors_origins: str = (
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:3001,http://127.0.0.1:3001,"
        "https://vedioanalysis.netlify.app,https://www.vedioanalysis.netlify.app,"
        "https://videoanalysis.netlify.app,https://www.videoanalysis.netlify.app"
    )
    cors_origin_regex: str = r"^https://.*\.netlify\.app$"
    # When True, allow any origin (use with allow_credentials=False). Set CORS_ALLOW_ALL=true on Railway if needed.
    cors_allow_all: bool = Field(default=False, validation_alias=AliasChoices("CORS_ALLOW_ALL"))

    redis_url: str = "redis://localhost:6379/0"
    # When False (default), run process_job in a daemon thread on the API process (works with a single container).
    # Set True only if you run a separate RQ worker (e.g. `python -m app.worker`) against the same Redis.
    use_rq_queue: bool = Field(default=False, validation_alias=AliasChoices("USE_RQ_QUEUE"))

    data_dir: str = "data"
    uploads_dir: str = "data/uploads"
    artifacts_dir: str = "data/artifacts"
    results_dir: str = "data/results"
    clips_dir: str = "data/clips"
    models_dir: str = "data/models"
    db_url: str = Field(
        default="sqlite:///./data/app.db",
        validation_alias=AliasChoices("DB_URL", "DATABASE_URL"),
    )

    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"

    whisper_model: str = "small"
    whisper_local_files_only: bool = False
    whisper_language: str | None = "en"

    # Optional: enables diarization if set and deps installed
    hf_token: str | None = None

    # InsightFace: True only with onnxruntime-gpu + working CUDA. False = CPU (typical Windows / no GPU).
    vision_insightface_gpu: bool = False

    # OpenAI (server-side channel AI summaries; FeedbackAgent also reads OPENAI_API_KEY via os.environ)
    openai_api_key: str = Field(default="", validation_alias=AliasChoices("OPENAI_API_KEY"))
    openai_base_url: str = Field(default="", validation_alias=AliasChoices("OPENAI_BASE_URL"))
    openai_channel_summary_model: str = Field(
        default="gpt-4o-mini",
        validation_alias=AliasChoices("OPENAI_CHANNEL_SUMMARY_MODEL", "OPENAI_MODEL"),
    )

    # YouTube (for real competitor ingest)
    youtube_api_key: str = ""
    youtube_max_videos: int = 10

    # Supabase (optional persistence layer)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    # Server-side key for backend/worker writes (DO NOT expose to frontend)
    supabase_service_role_key: str = ""
    # Alias for compatibility with deployments that use SUPABASE_SERVICE_KEY.
    # Prefer setting SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY in env.
    supabase_service_key: str = ""
    supabase_bucket: str = "videos"
    # Max object size for the Storage bucket (bytes). Applied on ensure-bucket via update_bucket.
    # Supabase Free tier may still enforce a lower project-wide cap; raise in Dashboard or upgrade if uploads fail.
    supabase_bucket_file_size_limit_bytes: int = 5368709120  # 5 GiB

    @model_validator(mode="after")
    def _merge_supabase_service_keys(self) -> "Settings":
        # Deployments often set SUPABASE_SERVICE_KEY; supabase_repo reads supabase_service_role_key.
        if not (self.supabase_service_role_key or "").strip() and (self.supabase_service_key or "").strip():
            object.__setattr__(self, "supabase_service_role_key", self.supabase_service_key.strip())
        return self


settings = Settings()

