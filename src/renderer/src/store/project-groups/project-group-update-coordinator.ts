import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

export type ProjectGroupMutationTicket = {
  generation: number
  fields: readonly string[]
  deletesGroup: boolean
}

type RepoSliceGet = Parameters<StateCreator<AppState>>[1]

const coordinators = new WeakMap<RepoSliceGet, ProjectGroupUpdateCoordinator>()

export function getProjectGroupUpdateCoordinator(get: RepoSliceGet): ProjectGroupUpdateCoordinator {
  const existing = coordinators.get(get)
  if (existing) {
    return existing
  }
  const coordinator = new ProjectGroupUpdateCoordinator()
  coordinators.set(get, coordinator)
  return coordinator
}

export class ProjectGroupUpdateCoordinator {
  private nextGeneration = 0
  private readonly mutationGenerationByIdentity = new Map<string, number>()
  private readonly deletionGenerationByIdentity = new Map<string, number>()
  private readonly generationByField = new Map<string, number>()

  begin(
    identity: string,
    fields: readonly string[],
    deletesGroup = false
  ): ProjectGroupMutationTicket {
    const generation = ++this.nextGeneration
    this.mutationGenerationByIdentity.set(identity, generation)
    if (deletesGroup) {
      this.deletionGenerationByIdentity.set(identity, generation)
    }
    for (const field of fields) {
      this.generationByField.set(`${identity}\0${field}`, generation)
    }
    return { generation, fields, deletesGroup }
  }

  latestFields(identity: string, ticket: ProjectGroupMutationTicket): string[] {
    return ticket.fields.filter(
      (field) => this.generationByField.get(`${identity}\0${field}`) === ticket.generation
    )
  }

  isLatestMutation(identity: string, ticket: ProjectGroupMutationTicket): boolean {
    return this.mutationGenerationByIdentity.get(identity) === ticket.generation
  }

  hasLaterDeletion(identity: string, ticket: ProjectGroupMutationTicket): boolean {
    return (this.deletionGenerationByIdentity.get(identity) ?? 0) > ticket.generation
  }

  finish(identity: string, ticket: ProjectGroupMutationTicket): void {
    for (const field of ticket.fields) {
      const fieldKey = `${identity}\0${field}`
      if (this.generationByField.get(fieldKey) === ticket.generation) {
        this.generationByField.delete(fieldKey)
      }
    }
    if (this.isLatestMutation(identity, ticket)) {
      this.mutationGenerationByIdentity.delete(identity)
    }
    if (
      ticket.deletesGroup &&
      this.deletionGenerationByIdentity.get(identity) === ticket.generation
    ) {
      this.deletionGenerationByIdentity.delete(identity)
    }
  }
}
