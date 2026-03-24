from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AI Video Performance Analyzer"
    api_base_url: str = "http://localhost:8000"

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


settings = Settings()

