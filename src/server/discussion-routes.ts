import { Router } from 'express';
import type { DiscussionId, DiscussionTeamId, DiscussionStatus } from '@foundation/discussion-types';
import type { TrackId } from '@foundation/types';
import type { DiscussionService } from '@application/discussion/discussion-service.js';
import type { DiscussionTeamRepository, DiscussionRepository, DiscussionSessionRepository } from '@domain/discussion/repository';

export interface DiscussionRouterDeps {
  discussionService: DiscussionService;
  teams: DiscussionTeamRepository;
  discussions: DiscussionRepository;
  discussionSessions: DiscussionSessionRepository;
}

export function createDiscussionRouter(deps: DiscussionRouterDeps): Router {
  const router = Router();
  const { discussionService, teams, discussions, discussionSessions } = deps;

  // === Discussion Teams ===

  router.get('/discussion-teams', (_req, res) => {
    res.json(teams.findAll());
  });

  router.post('/discussion-teams', (req, res) => {
    const { name, description, consensusRule, memberAgentIds } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!consensusRule) {
      res.status(400).json({ error: 'consensusRule is required' });
      return;
    }
    if (!memberAgentIds || !Array.isArray(memberAgentIds) || memberAgentIds.length === 0) {
      res.status(400).json({ error: 'memberAgentIds must be a non-empty array' });
      return;
    }
    const team = discussionService.createTeam({ name, description, consensusRule, memberAgentIds });
    res.status(201).json(team);
  });

  router.put('/discussion-teams/:id', (req, res) => {
    const id = req.params.id as DiscussionTeamId;
    const { name, description, consensusRule, memberAgentIds } = req.body;
    const updated = discussionService.updateTeam(id, { name, description, consensusRule, memberAgentIds });
    if (!updated) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    res.json(updated);
  });

  router.delete('/discussion-teams/:id', (req, res) => {
    const id = req.params.id as DiscussionTeamId;
    const deleted = discussionService.deleteTeam(id);
    if (!deleted) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    res.status(204).send();
  });

  // === Discussions ===

  router.get('/discussions', (req, res) => {
    const filters: { status?: DiscussionStatus; teamId?: DiscussionTeamId; trackId?: TrackId } = {};
    if (req.query.status) filters.status = req.query.status as DiscussionStatus;
    if (req.query.teamId) filters.teamId = req.query.teamId as DiscussionTeamId;
    if (req.query.trackId) filters.trackId = req.query.trackId as TrackId;
    res.json(discussions.findAll(filters));
  });

  router.get('/discussions/:id', (req, res) => {
    const state = discussionService.getDiscussionState(req.params.id as DiscussionId);
    if (!state) {
      res.status(404).json({ error: 'Discussion not found' });
      return;
    }
    res.json(state);
  });

  router.post('/discussions', async (req, res) => {
    try {
      const { teamId, title, type, artifact, trackId, staleAfterMinutes, createdByType, createdById } = req.body;
      if (!teamId || typeof teamId !== 'string') {
        res.status(400).json({ error: 'teamId is required' });
        return;
      }
      if (!title || typeof title !== 'string') {
        res.status(400).json({ error: 'title is required' });
        return;
      }
      const discussion = await discussionService.createDiscussion({
        teamId: teamId as DiscussionTeamId,
        title,
        type,
        artifact,
        trackId: trackId as TrackId | undefined,
        staleAfterMinutes,
        createdByType,
        createdById,
      });
      res.status(201).json(discussion);
    } catch (err) {
      console.error('Failed to create discussion:', err);
      const msg = err instanceof Error ? err.message : 'Failed to create discussion';
      res.status(500).json({ error: msg });
    }
  });

  router.post('/discussions/:id/messages', (req, res) => {
    try {
      const discussionId = req.params.id as DiscussionId;
      const { authorType, authorId, authorName, messageType, content } = req.body;
      if (!messageType || !content) {
        res.status(400).json({ error: 'messageType and content are required' });
        return;
      }
      const message = discussionService.postMessage(discussionId, {
        authorType: authorType || 'human',
        authorId,
        authorName,
        messageType,
        content,
      });
      res.status(201).json(message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to post message';
      res.status(400).json({ error: msg });
    }
  });

  router.post('/discussions/:id/votes', async (req, res) => {
    try {
      const discussionId = req.params.id as DiscussionId;
      const { voterType, voterId, voterName, vote, comment } = req.body;
      if (!voterId || !vote) {
        res.status(400).json({ error: 'voterId and vote are required' });
        return;
      }
      const result = await discussionService.castVote(discussionId, {
        voterType: voterType || 'human',
        voterId,
        voterName,
        vote,
        comment,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to cast vote';
      res.status(400).json({ error: msg });
    }
  });

  // Act on consensus: spawn an agent to implement the discussion outcome
  router.post('/discussions/:id/act', async (req, res) => {
    try {
      const discussionId = req.params.id as DiscussionId;
      const result = await discussionService.actOnConsensus(discussionId);
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to act on discussion';
      res.status(400).json({ error: msg });
    }
  });

  router.post('/discussions/:id/close', async (req, res) => {
    try {
      const discussionId = req.params.id as DiscussionId;
      await discussionService.closeDiscussion(discussionId);
      res.json({ message: 'Discussion closed' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to close discussion';
      res.status(500).json({ error: msg });
    }
  });

  // Get agent sessions linked to a discussion (used for permission polling)
  router.get('/discussions/:id/sessions', (req, res) => {
    const discussionId = req.params.id as DiscussionId;
    const sessions = discussionSessions.findByDiscussion(discussionId);
    res.json(sessions);
  });

  router.delete('/discussions/:id', async (req, res) => {
    try {
      const discussionId = req.params.id as DiscussionId;
      await discussionService.closeDiscussion(discussionId);
      discussions.delete(discussionId);
      res.status(204).send();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete discussion';
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
