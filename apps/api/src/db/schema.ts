import { pgTable, uuid, varchar, text, timestamp, pgEnum, primaryKey, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const chatTypeEnum = pgEnum("chat_type", ["dm", "group"]);
export const memberRoleEnum = pgEnum("member_role", ["member", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }),
  username: varchar("username", { length: 100 }).notNull(),
  avatarUrl: text("avatar_url"),
  coverUrl: text("cover_url"),
  bio: text("bio"),
  /** JSON array of upload paths */
  profilePhotos: text("profile_photos"),
  /** JSON array of previous avatar upload paths (newest first) */
  avatarHistory: text("avatar_history"),
  yandexId: varchar("yandex_id", { length: 64 }).unique(),
  yandexLogin: varchar("yandex_login", { length: 64 }),
  /** Yandex birthday YYYY-MM-DD (year may be 0000) */
  birthday: varchar("birthday", { length: 10 }),
  birthdayVisible: boolean("birthday_visible").notNull().default(false),
  subscriptionTier: varchar("subscription_tier", { length: 20 }).notNull().default("free"),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
  betaApproved: boolean("beta_approved").notNull().default(false),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  yookassaPaymentId: varchar("yookassa_payment_id", { length: 64 }),
  amount: varchar("amount", { length: 20 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("RUB"),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  plan: varchar("plan", { length: 32 }).notNull().default("platinum"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chats = pgTable("chats", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: chatTypeEnum("type").notNull().default("dm"),
  name: varchar("name", { length: 255 }),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chatMembers = pgTable(
  "chat_members",
  {
    chatId: uuid("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
    muted: boolean("muted").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.userId] })]
);

export const userContacts = pgTable(
  "user_contacts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    contactUserId: uuid("contact_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contactUserId] })]
);

/** Uploaded media registry for access control */
export const mediaFiles = pgTable("media_files", {
  filename: varchar("filename", { length: 255 }).primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** chat = only chat members with grant; profile = any authenticated user */
  visibility: varchar("visibility", { length: 16 }).notNull().default("chat"),
  /** Original upload name for Content-Disposition when downloading */
  originalName: varchar("original_name", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Which chats may access a chat-scoped media file (filled when message is sent) */
export const mediaChatGrants = pgTable(
  "media_chat_grants",
  {
    filename: varchar("filename", { length: 255 })
      .notNull()
      .references(() => mediaFiles.filename, { onDelete: "cascade" }),
    chatId: uuid("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.filename, t.chatId] })]
);

export const usersRelations = relations(users, ({ many }) => ({
  chatMembers: many(chatMembers),
  payments: many(payments),
  pushSubscriptions: many(pushSubscriptions),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [pushSubscriptions.userId], references: [users.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  user: one(users, { fields: [payments.userId], references: [users.id] }),
}));

export const chatsRelations = relations(chats, ({ many }) => ({
  members: many(chatMembers),
}));

export const chatMembersRelations = relations(chatMembers, ({ one }) => ({
  chat: one(chats),
  user: one(users),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type ChatMember = typeof chatMembers.$inferInsert;
