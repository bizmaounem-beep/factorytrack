# Database Safety Rules

All future code modifications and generations must adhere strictly to these rules regarding the SQLite database:

1. **Never Overwrite**: Do NOT include any code that deletes (`DROP TABLE`), clears (`DELETE FROM`), or resets tables if they already exist.
2. **Locked Path**: The database path is strictly locked at `process.env.DB_DIR || path.join(process.cwd(), 'data/factory.db')`. Do NOT revert to `data.db` or create new file names for the database.
3. **Preserve Existing Records**: Do NOT re-seed the database with default values if the `users` table already contains data. 
4. **Data Persistence**: Treat the existing data inside `/data/factory.db` as read-only structural data that must be preserved at all costs. Maintenance scripts or initializations must check for existing records before attempting any inserts.
