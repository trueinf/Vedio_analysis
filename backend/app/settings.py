from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AI Video Performance Analyzer"
    api_base_url: str = "http://localhost:8000"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,https://vedioanalysis.netlify.app"
    cors_origin_regex: str = r"^https://.*\.netlify\.app$"

    redis_url: str = "redis://localhost:6379/0"

    data_dir: str = "data"
    uploads_dir: str = "data/uploads"
    artifacts_dir: str = "data/artifacts"
    results_dir: str = "data/results"
    clips_dir: str = "data/clips"
    models_dir: str = "data/models"
    db_url: str = "sqlite:///./data/app.db"

    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"

    whisper_model: str = "small"
    whisper_local_files_only: bool = False
    whisper_language: str | None = "en"

    # Optional: enables diarization if set and deps installed
    hf_token: str | None = None

    # InsightFace: True only with onnxruntime-gpu + working CUDA. False = CPU (typical Windows / no GPU).
    vision_insightface_gpu: bool = False

    # YouTube (for real competitor ingest)
    youtube_api_key: str = ""
    youtube_max_videos: int = 10

    # Supabase (optional persistence layer)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    # Server-side key for backend/worker writes (DO NOT expose to frontend)
    supabase_service_role_key: str = ""
    supabase_bucket: str = "videos"
    # Max object size for the Storage bucket (bytes). Applied on ensure-bucket via update_bucket.
    # Supabase Free tier may still enforce a lower project-wide cap; raise in Dashboard or upgrade if uploads fail.
    supabase_bucket_file_size_limit_bytes: int = 5368709120  # 5 GiB


settings = Settings()

