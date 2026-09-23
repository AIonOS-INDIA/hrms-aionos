CREATE POLICY "expense_receipts_own_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'expense-receipts' AND (storage.foldername(name))[1] = private.my_employee_id()::text);

CREATE POLICY "expense_receipts_own_select" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'expense-receipts' AND (
    (storage.foldername(name))[1] = private.my_employee_id()::text
    OR private.can_manage_company(private.employee_company(NULLIF((storage.foldername(name))[1], '')::uuid))
  )
);

CREATE POLICY "expense_receipts_own_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'expense-receipts' AND (
    (storage.foldername(name))[1] = private.my_employee_id()::text
    OR private.can_manage_company(private.employee_company(NULLIF((storage.foldername(name))[1], '')::uuid))
  )
);