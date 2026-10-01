from functools import lru_cache
from typing import Self

from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="WMGJ_",
        extra="ignore",
        case_sensitive=False,
    )

    env: str = "local"
    service_name: str = "wmgj-control-plane"
    firebase_project_id: str | None = None
    allowed_orgs: tuple[str, ...] = ("wmgj",)
    openai_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENAI_API_KEY", "WMGJ_OPENAI_API_KEY"),
    )
    openai_model: str = "gpt-5.6"
    openai_prompt_version: str = "wmgj-audit-v1"
    openai_ruleset_version: str = "wmgj-rules-v1"
    openai_execution_enabled: bool = False
    clinical_ai_enabled: bool = False
    require_app_check: bool = True
    require_mfa_for_reviews: bool = True
    dashboard_delayed_after_seconds: int = 90
    dashboard_stale_after_seconds: int = 300

    @field_validator("allowed_orgs", mode="before")
    @classmethod
    def parse_allowed_orgs(cls, value: object) -> object:
        if isinstance(value, str):
            return tuple(item.strip() for item in value.split(",") if item.strip())
        return value

    @field_validator("dashboard_delayed_after_seconds", "dashboard_stale_after_seconds")
    @classmethod
    def positive_timeout(cls, value: int) -> int:
        if value < 1:
            raise ValueError("dashboard timeouts must be positive")
        return value

    @model_validator(mode="after")
    def stale_threshold_follows_delayed(self) -> Self:
        if self.dashboard_stale_after_seconds <= self.dashboard_delayed_after_seconds:
            raise ValueError("dashboard stale threshold must exceed delayed threshold")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
