# Database diagram

Implemented schema as of M1 (2026-11-25). Column details and access rules: [DATA-DICTIONARY.md](DATA-DICTIONARY.md).
Planned entities (sessions, programs, posts, follows, rewards, sync) are in [DATA_AND_SYNC.md](DATA_AND_SYNC.md) and
will be added here as their migrations land.

## Server (Supabase)

```mermaid
erDiagram
    AUTH_USERS ||--o| PROFILES : "has identity"
    AUTH_USERS ||--o| USER_SETTINGS : "has preferences"
    AUTH_USERS ||--o{ WEEKLY_GOALS : "sets goal history"
    AUTH_USERS ||--o| TRAINING_PROFILES : "has private training profile"
    AUTH_USERS ||--o{ BODY_WEIGHT_ENTRIES : "records"
    AUTH_USERS ||--o{ STORAGE_OBJECTS_AVATARS : "owns folder"
    PROFILES |o--o| STORAGE_OBJECTS_AVATARS : "avatar_path"

    AUTH_USERS {
        uuid id PK "managed by Supabase Auth"
        text email
    }
    PROFILES {
        uuid id PK,FK "= auth.users.id"
        text handle UK "^[a-z0-9_]{3,30}$"
        text display_name
        text avatar_path "<id>/..."
        profile_visibility visibility "public | private"
        timestamptz created_at
        timestamptz updated_at
    }
    USER_SETTINGS {
        uuid owner_id PK,FK
        weight_unit weight_unit "kg | lb"
        length_unit length_unit "cm | ft_in"
        text timezone "IANA"
        timestamptz created_at
        timestamptz updated_at
    }
    WEEKLY_GOALS {
        uuid owner_id PK,FK
        date effective_week PK "Monday"
        smallint target_days "1-7"
        text timezone "frozen per row"
        timestamptz created_at
        timestamptz updated_at
    }
    TRAINING_PROFILES {
        uuid owner_id PK,FK
        text goal
        smallint age
        numeric height_cm
        experience_level experience
        text_array equipment
        text limitations
        smallint_array available_weekdays "ISO 1-7"
        smallint session_minutes
        timestamptz created_at
        timestamptz updated_at
    }
    BODY_WEIGHT_ENTRIES {
        uuid id PK
        uuid owner_id FK
        timestamptz measured_at
        integer weight_grams
        timestamptz created_at
        timestamptz updated_at
    }
    STORAGE_OBJECTS_AVATARS {
        uuid id PK
        text bucket_id "avatars"
        text name "<owner id>/<file>"
    }
```

Visibility: `PROFILES` is readable by any signed-in user; every other table is owner-only. `anon` has no access.

## Device (SQLite, one file per account)

```mermaid
erDiagram
    ACCOUNT_PROFILE {
        text id PK
        text handle
        text display_name
        text visibility
        text avatar_path
        text updated_at
    }
    USER_SETTINGS {
        integer id PK "always 1"
        text weight_unit
        text length_unit
        text timezone
        text updated_at
    }
    WEEKLY_GOALS {
        text effective_week PK
        integer target_days
        text timezone
    }
```

Device tables are a cache of the signed-in account's server rows; the file itself is the account boundary,
so no owner columns are needed.
