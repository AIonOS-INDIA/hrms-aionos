# Roadmap
- [x] Employees: clickable stat tiles filter roster
- [x] Employees: edit employee record (all fields) for Master/Company HR
- [x] Employees: add new employee (Onboard form)
- [x] Clickable stat tiles on leave, joining, separation, benefits, learning, compliance, hiring, performance, payroll, salary, timesheets
- [x] Shared existing-value pick lists (designation, band, department, business unit, legal entity, location, city, area)
- [x] Hiring: role title picklist, hiring manager, interview outcome/feedback
- [x] Payroll + timesheets: employee hour entry, HR/finance approval, payslips use approved hours

## Queued
- [x] WhatsApp + Microsoft Teams chat channels (profile connect UI, QR, webhook) — WhatsApp needs the company number switched on; Teams needs the Microsoft connector approved
- [ ] Payroll payments: HR approves a payslip, finance signs off, record actual payment date and amount
- [ ] Recruitment tiles open/filter the recruitment page (post a job, review applications, track interviews)
- [x] Performance: managers rate their own reports, HR reviews and shares, reusing existing value lists
- [x] Performance dashboard: per-employee ratings, reviews and goals, plus manager view of direct reports with a rating history timeline
- [ ] Phone-friendly layout for dashboard, leave, timesheets, performance
- [ ] Connect real Meta WhatsApp number (token, phone number ID, business number, app secret, verify word) so inbound messages reach the assistant
- [ ] Inbound WhatsApp messages perform real leave/timesheet actions with HR + finance approval routing

## Manager, skip-level and executive
- [x] Approvals extended up the line: a manager of managers and executives act for their whole branch
- [x] Interactive org chart page with per-person leave, timesheet and performance summary
- [x] Time filter on the summary, default last 30 days

## Manager capabilities
- [x] "My team" page: direct reports plus leave, timesheet, expense and resignation approvals
- [x] Manager approval rights in the database (read + decide for direct reports only)
- [x] Dashboard strip showing what is waiting on a manager

## Assets & hiring source
- [x] Employee assets (hardware, licences, subscriptions) with IT/HR/finance duty editing + Excel bulk load
- [x] Direct manager approval step in the separation workflow
- [x] "Hired from" source field on the employee record (pick list + new values), HR editable
- [x] Employee Excel import/export covers every employee field incl. hired-from and assigned assets

## Expenses & finance roles
- [x] Expense claims, receipts (photo/file), finance review and reimbursement
- [x] Expenses page + menu entry; assistant/WhatsApp expense actions
- [x] Expense approver and Payroll approver duties, assignable in Admin
- [x] Payslip approval button on the Finance page
- [ ] Email the claim link to finance on submit — blocked: no verified sending domain yet

## Entity setup & exit settlement
- [x] Entity setup page: legal entity, email domain, salary structure split, deduction rules
- [x] Exit workflow routes final settlement, unpaid leave and approved expenses to finance (payroll approvers can pay out and close)
