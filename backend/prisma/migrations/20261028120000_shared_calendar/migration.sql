ALTER TABLE "TaskAssignment" ADD COLUMN "start_minute" INTEGER NOT NULL DEFAULT 540;

CREATE TABLE "GoogleCalendarConnection" (
  "user_id" UUID NOT NULL,
  "refresh_token" TEXT NOT NULL,
  "calendar_id" TEXT NOT NULL DEFAULT 'primary',
  "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "GoogleCalendarConnection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "GoogleBusyBlock" (
  "id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "event_date" DATE NOT NULL,
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleBusyBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleBusyBlock_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GoogleBusyBlock_user_id_event_date_idx" ON "GoogleBusyBlock"("user_id", "event_date");
