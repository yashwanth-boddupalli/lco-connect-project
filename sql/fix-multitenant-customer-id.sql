-- ================================================================
-- LCO CONNECT — Multi-Tenant Customer ID Migration & Auto-ID Trigger
-- ================================================================

BEGIN;

-- 1. DROP GLOBAL UNIQUE CONSTRAINT AND OLD INDEX
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_customer_id_key;

DROP INDEX IF EXISTS public.idx_customers_customer_id;

-- 2. ADD COMPOSITE UNIQUE CONSTRAINT (lco_id, customer_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_lco_id_customer_id_key'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_lco_id_customer_id_key
      UNIQUE (lco_id, customer_id);
  END IF;
END $$;

-- 3. CREATE COMPOSITE INDEX FOR FAST TENANT LOOKUPS
CREATE INDEX IF NOT EXISTS idx_customers_lco_customer_id
  ON public.customers(lco_id, customer_id);


-- 4. SECURE, SCOPED & CONCURRENCY-SAFE GENERATION FUNCTION
CREATE OR REPLACE FUNCTION public.generate_customer_id(
  p_lco_id UUID DEFAULT public.get_lco_id()
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lco_id UUID := COALESCE(p_lco_id, public.get_lco_id());
  v_caller_lco_id UUID := public.get_lco_id();
  v_next_seq INT;
  v_new_id TEXT;
BEGIN
  IF v_lco_id IS NULL THEN
    RAISE EXCEPTION 'LCO ID is required to generate customer ID.';
  END IF;

  -- Security Check: Caller must belong to requested LCO or be Super Admin
  IF v_caller_lco_id IS NOT NULL AND v_caller_lco_id IS DISTINCT FROM v_lco_id AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Cannot generate customer ID for another LCO.';
  END IF;

  -- Row-level lock on lco_applications to serialize concurrent generation for this specific LCO
  PERFORM 1 FROM public.lco_applications WHERE id = v_lco_id FOR UPDATE;

  -- Find max integer suffix among CUST-XXXX format for THIS specific LCO
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(customer_id FROM '^CUST-([0-9]+)$') AS INT)
  ), 0) + 1
  INTO v_next_seq
  FROM public.customers
  WHERE lco_id = v_lco_id;

  v_new_id := 'CUST-' || LPAD(v_next_seq::TEXT, 4, '0');

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_customer_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_customer_id(UUID) TO authenticated;


-- 5. AUTHORITATIVE BEFORE INSERT TRIGGER FOR ATOMIC ID GENERATION
CREATE OR REPLACE FUNCTION public.trg_auto_generate_customer_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_lco_id UUID := public.get_lco_id();
BEGIN
  -- Resolve lco_id using caller context if missing
  IF NEW.lco_id IS NULL THEN
    NEW.lco_id := v_caller_lco_id;
  END IF;

  IF NEW.lco_id IS NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unable to determine LCO identity for customer creation.';
  END IF;

  -- Security Check: Enforce tenant ownership unless caller is Super Admin
  IF v_caller_lco_id IS NOT NULL AND NEW.lco_id IS DISTINCT FROM v_caller_lco_id AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Cannot create customer for another LCO.';
  END IF;

  -- Auto-generate customer_id if NULL or blank
  IF NEW.customer_id IS NULL OR TRIM(NEW.customer_id) = '' THEN
    NEW.customer_id := public.generate_customer_id(NEW.lco_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_auto_id ON public.customers;
CREATE TRIGGER trg_customers_auto_id
  BEFORE INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_generate_customer_id();

COMMIT;
