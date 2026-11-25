# Database diagram

Implemented server schema as of M6 (2026-11-25). Column details and access rules: [DATA-DICTIONARY.md](DATA-DICTIONARY.md).

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
        integer revision
        boolean deleted
        timestamptz created_at
        timestamptz updated_at
    }
    STORAGE_OBJECTS_AVATARS {
        uuid id PK
        text bucket_id "avatars"
        text name "<owner id>/<file>"
    }
```

Visibility: `PROFILES` is readable by any signed-in user (except across a block); every other table is owner-only. `anon` has no access.

### Training, sync, rewards and coach (M3-M5)

```mermaid
erDiagram
    AUTH_USERS ||--o{ CUSTOM_EXERCISES : owns
    AUTH_USERS ||--o{ ROUTINES : owns
    AUTH_USERS ||--o{ PROGRAMS : "owns (max 1 active)"
    AUTH_USERS ||--o{ SESSIONS : "owns (max 1 active)"
    AUTH_USERS ||--o| ACCOUNT_SYNC_STATE : "seq lock"
    AUTH_USERS ||--o{ OPERATION_RECEIPTS : "applied ops"
    AUTH_USERS ||--o{ SERVER_CHANGE_LOG : changes
    AUTH_USERS ||--o{ REWARD_EVENTS : earns
    REWARD_EVENTS ||--o{ REWARD_EVENT_LOG : audits
    AUTH_USERS ||--o{ ACHIEVEMENT_UNLOCKS : unlocks
    AUTH_USERS ||--o{ PET_UNLOCKS : unlocks
    AUTH_USERS ||--o{ COACH_REQUESTS : requests
    COACH_REQUESTS ||--|| COACH_DRAFTS : produces
    PROGRAMS }o..o{ ROUTINES : "doc.days[].routineId"
    SESSIONS }o..o| ROUTINES : "routine_id (snapshot)"
    SESSIONS ||..o| REWARD_EVENTS : "source_id"

    SESSIONS {
        uuid id PK "client id"
        uuid owner_id FK
        int revision
        boolean deleted "tombstone"
        text status "active | completed"
        timestamptz started_at
        timestamptz completed_at
        text timezone
        date local_date
        jsonb doc "SessionDoc"
    }
    PROGRAMS {
        uuid id PK
        uuid owner_id FK
        int revision
        boolean deleted
        boolean active
        text origin "manual | coach"
        uuid coach_draft_id
        jsonb doc "ProgramDoc"
    }
    ROUTINES {
        uuid id PK
        uuid owner_id FK
        int revision
        boolean deleted
        text origin
        jsonb doc "RoutineDoc"
    }
    CUSTOM_EXERCISES {
        uuid id PK
        uuid owner_id FK
        int revision
        boolean deleted
        jsonb doc "CustomExerciseDoc"
    }
    ACCOUNT_SYNC_STATE {
        uuid owner_id PK
        bigint last_seq
    }
    OPERATION_RECEIPTS {
        uuid owner_id PK
        uuid op_id PK
        jsonb result
    }
    SERVER_CHANGE_LOG {
        uuid owner_id PK
        bigint seq PK
        text aggregate_type UK
        uuid aggregate_id UK
        int revision
        boolean deleted
    }
    REWARD_EVENTS {
        bigint id PK
        uuid owner_id FK
        text source_type UK
        text source_id UK
        text reason UK
        int rule_version UK
        int xp
        boolean active
    }
    REWARD_EVENT_LOG {
        bigint id PK
        bigint reward_event_id FK
        text action "award | revoke | restore"
        int xp
    }
    ACHIEVEMENT_UNLOCKS {
        uuid owner_id PK
        text badge_id PK
        timestamptz unlocked_at
    }
    PET_UNLOCKS {
        uuid owner_id PK
        smallint stage PK
        timestamptz unlocked_at
    }
    COACH_REQUESTS {
        uuid owner_id PK
        uuid request_id PK
        text mode
        jsonb input "minimized"
        text status
    }
    COACH_DRAFTS {
        uuid id PK
        uuid owner_id FK
        uuid request_id FK
        text status
        uuid base_program_id
        int base_program_revision
        jsonb content
        uuid approval_id UK
    }
```

### Social (M6)

```mermaid
erDiagram
    AUTH_USERS ||--o{ FOLLOWS : "requester / followee"
    AUTH_USERS ||--o{ BLOCKS : "blocker / blocked"
    AUTH_USERS ||--o{ POSTS : authors
    SESSIONS |o..o{ POSTS : "source_session_id (set null)"
    POSTS ||--o{ LIKES : has
    POSTS ||--o{ COMMENTS : has
    POSTS |o--o| STORAGE_OBJECTS_POST_PHOTOS : photo_path

    FOLLOWS {
        uuid requester_id PK
        uuid followee_id PK
        text status "pending | accepted"
    }
    BLOCKS {
        uuid blocker_id PK
        uuid blocked_id PK
    }
    POSTS {
        uuid id PK "client publication id"
        uuid author_id FK
        uuid source_session_id FK
        jsonb snapshot "PostSnapshot (server-built)"
        text caption "max 500"
        text photo_path "author/id.ext"
        int revision
        boolean deleted
        timestamptz published_at
    }
    LIKES {
        uuid post_id PK
        uuid user_id PK
    }
    COMMENTS {
        uuid id PK
        uuid post_id FK
        uuid author_id FK
        text body "1-1000"
    }
    STORAGE_OBJECTS_POST_PHOTOS {
        text bucket_id "post-photos (private)"
        text name "owner id/post id.ext"
    }
```

Post access: author, or no block either way and (author public or accepted follower).

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
