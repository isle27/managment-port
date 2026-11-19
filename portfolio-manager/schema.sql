BEGIN;
CREATE TABLE IF NOT EXISTS public.portfolio_projects (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL,
  image text NOT NULL,
  technologies text[] NOT NULL DEFAULT '{}',
  github text CHECK (github ~ '^https?://'),
  live text CHECK (live ~ '^https?://'),
  featured boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100
);
ALTER TABLE public.portfolio_projects
  ADD COLUMN IF NOT EXISTS show_on_se boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_on_qa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_on_ai boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_category text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_overview text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_outcomes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_sample boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_legacy_slug text;

CREATE SCHEMA IF NOT EXISTS portfolio_manager;
CREATE TABLE IF NOT EXISTS portfolio_manager.applied_imports (name text PRIMARY KEY);

DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects'
      AND column_name IN ('slug', 'title', 'description', 'category', 'overview', 'outcomes',
        'stack', 'github_url', 'demo_url', 'position', 'published', 'sample')
    HAVING count(*) = 12
  ) THEN
    INSERT INTO portfolio_manager.applied_imports VALUES ('ai_projects_v1')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.portfolio_projects (
        slug, title, description, image, technologies, github, live, published, sort_order,
        show_on_se, show_on_ai, ai_category, ai_overview, ai_outcomes, ai_sample, ai_legacy_slug
      )
      SELECT 'ai-legacy-' || md5(p.slug), p.title, p.description, '', p.stack,
        CASE WHEN p.github_url ~ '^https?://' THEN p.github_url END,
        CASE WHEN p.demo_url ~ '^https?://' THEN p.demo_url END,
        p.published, p.position, false, true, p.category, p.overview, p.outcomes, p.sample, p.slug
      FROM public.projects p
      ORDER BY p.position, p.slug;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.portfolio_published_projects AS
SELECT id, title, description, image, technologies, github, live, featured,
  sort_order, show_on_se, show_on_qa, show_on_ai, ai_category, ai_overview, ai_outcomes, ai_sample,
  COALESCE(ai_legacy_slug, slug) AS project_slug
FROM public.portfolio_projects WHERE published;

CREATE OR REPLACE FUNCTION portfolio_manager.move_existing_project(project_id integer, direction int)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  current_rank bigint;
  project_count bigint;
BEGIN
  IF direction IS NULL OR direction NOT IN (-1, 1) THEN RETURN false; END IF;
  LOCK TABLE public.portfolio_projects IN SHARE ROW EXCLUSIVE MODE;
  SELECT r.rank, r.total INTO current_rank, project_count
  FROM (
    SELECT id, row_number() OVER (ORDER BY sort_order, id) AS rank,
      count(*) OVER () AS total FROM public.portfolio_projects
  ) r WHERE r.id = project_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF current_rank + direction BETWEEN 1 AND project_count THEN
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY sort_order, id) AS rank FROM public.portfolio_projects
    )
    UPDATE public.portfolio_projects p
    SET sort_order = CASE
      WHEN r.rank = current_rank THEN current_rank + direction
      WHEN r.rank = current_rank + direction THEN current_rank
      ELSE r.rank END
    FROM ranked r WHERE p.id = r.id;
  END IF;
  RETURN true;
END;
$$;
COMMIT;
