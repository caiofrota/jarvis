import { createDatabase, Repository } from "@rosie/db";
import { HomeAssistantAuthorization } from "./addons/home-assistant-auth";
import { Pairing } from "./auth/pairing";
import { PersonalProfiles } from "./auth/profiles";
import { Authentication } from "./auth/service";
import { Automations } from "./automation/service";
import { ResidentCalendars } from "./calendar/service";
import { CatalogService } from "./catalog/service";
import type { AppConfig } from "./config";
import { CompanionConversation } from "./conversation/companion";
import { Conversation } from "./conversation/service";
import { PersonalIntegrations } from "./personal/service";
import { RobotGateway } from "./robot/gateway";
import { Interactions } from "./robot/interactions";
import { VoiceClient } from "./voice/client";
import { HomeAssistantVoice } from "./voice/home-assistant";
import { VoiceProfiles } from "./voice/profiles";

export function createRuntime(config: AppConfig) {
  const repo = new Repository(createDatabase(config.databaseUrl)),
    catalog = new CatalogService(repo),
    auth = new Authentication(repo, config),
    profiles = new PersonalProfiles(repo),
    personalIntegrations = new PersonalIntegrations(repo, config.origin, config.adminToken),
    pairing = new Pairing(),
    automations = new Automations(repo),
    calendars = new ResidentCalendars(repo, () => automations.addons.calendar),
    conversation = new Conversation(repo, automations),
    previewConversation = new Conversation(repo, automations),
    companion = new CompanionConversation(
      repo,
      automations.addons.homeAssistant,
      profiles,
      personalIntegrations,
    ),
    voice = new VoiceClient(
      config.voiceUrl,
      config.voiceToken,
      new HomeAssistantVoice(repo, automations.addons.homeAssistant),
    ),
    voiceProfiles = new VoiceProfiles(repo, voice),
    gateway = new RobotGateway(repo, voice, conversation, voiceProfiles),
    interactions = new Interactions(repo, gateway, automations.addons.mqtt),
    homeAssistantAuthorization = new HomeAssistantAuthorization(repo, config.origin);
  return {
    config,
    repo,
    catalog,
    auth,
    profiles,
    personalIntegrations,
    pairing,
    automations,
    calendars,
    conversation,
    previewConversation,
    companion,
    voice,
    voiceProfiles,
    gateway,
    interactions,
    homeAssistantAuthorization,
  };
}
export type Runtime = ReturnType<typeof createRuntime>;
