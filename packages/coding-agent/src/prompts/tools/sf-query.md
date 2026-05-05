Execute SOQL queries against Salesforce via sf CLI. Returns structured results as markdown tables.

<instruction>
Use for pipeline reporting, case management, account intelligence, and ad-hoc data queries.

Common query templates (substitute {userId} from cached xcsh.user.id in ~/.sf/config.json):

Pipeline summary:
  SELECT StageName, COUNT(Id) TotalDeals, SUM(Amount) TotalAmount FROM Opportunity WHERE IsClosed = false GROUP BY StageName ORDER BY SUM(Amount) DESC LIMIT 50

My open deals:
  SELECT Name, StageName, Amount, CloseDate, Account.Name FROM Opportunity WHERE OwnerId = '{userId}' AND IsClosed = false ORDER BY CloseDate LIMIT 50

Open cases:
  SELECT CaseNumber, Subject, Status, Priority, Account.Name, CreatedDate FROM Case WHERE IsClosed = false ORDER BY Priority, CreatedDate DESC LIMIT 50

Account overview:
  SELECT Name, Industry, AnnualRevenue, Type, Owner.Name FROM Account WHERE Type = 'Customer' ORDER BY AnnualRevenue DESC LIMIT 50

Results with relationship fields (e.g., Account.Name) are automatically flattened into dot-notation columns.
If the query returns more than 10,000 records, suggest using sf data export bulk instead.
Set use_tooling_api to true when querying metadata objects (ApexTrigger, ApexClass, CustomField).
Set all_rows to true to include deleted or archived records in results.
</instruction>
