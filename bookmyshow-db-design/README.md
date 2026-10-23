# BookMyShow Database Design

## Problem Statement

Design a simple database for a BookMyShow-like movie listing screen. A user selects a theatre and a date, and the system shows all movies playing at that theatre with their show timings.

## Scope

This design focuses only on movie scheduling. It does not include users, bookings, seats, tickets, payments, pricing, offers, or authentication.

## Entities

### theatres

Stores theatre details.

| Attribute | Description |
| --- | --- |
| theatre_id | Unique id for each theatre |
| theatre_name | Name of the theatre |
| location | Theatre location |

Primary key: `theatre_id`

### screens

Stores screens inside a theatre.

| Attribute | Description |
| --- | --- |
| screen_id | Unique id for each screen |
| theatre_id | Theatre to which the screen belongs |
| screen_name | Screen name, such as Screen 1 |

Primary key: `screen_id`

Foreign key: `theatre_id` references `theatres(theatre_id)`

### movies

Stores movie details.

| Attribute | Description |
| --- | --- |
| movie_id | Unique id for each movie |
| title | Movie title |
| language | Movie language |
| format | Movie format, such as 2D or 3D |
| certificate | Movie certificate |

Primary key: `movie_id`

### shows

Stores scheduled movie shows.

| Attribute | Description |
| --- | --- |
| show_id | Unique id for each show |
| movie_id | Movie being shown |
| screen_id | Screen where the show is scheduled |
| show_date | Date of the show |
| start_time | Start time of the show |

Primary key: `show_id`

Foreign keys:

- `movie_id` references `movies(movie_id)`
- `screen_id` references `screens(screen_id)`

## Relationships

- One theatre can have many screens.
- One screen belongs to one theatre.
- One movie can have many shows.
- One screen can have many shows across different dates and times.
- One show belongs to one movie and one screen.

## ER-Style Text Diagram

```text
theatres (1) ---- (many) screens (1) ---- (many) shows (many) ---- (1) movies
```

## Sample Rows

### theatres

| theatre_id | theatre_name | location |
| --- | --- | --- |
| 1 | PVR Nexus Forum | Koramangala, Bengaluru |

### screens

| screen_id | theatre_id | screen_name |
| --- | --- | --- |
| 1 | 1 | Screen 1 |
| 2 | 1 | Screen 2 |
| 3 | 1 | Screen 3 |

### movies

| movie_id | title | language | format | certificate |
| --- | --- | --- | --- | --- |
| 1 | Dasara | Telugu | 2D | UA |
| 2 | Kisi Ka Bhai Kisi Ki Jaan | Hindi | 2D | UA |
| 3 | Tu Jhoothi Main Makkaar | Hindi | 2D | UA |
| 4 | Avatar: The Way of Water | English | 3D | UA |

### shows

| show_id | movie_id | screen_id | show_date | start_time |
| --- | --- | --- | --- | --- |
| 1 | 1 | 1 | 2023-04-25 | 12:15:00 |
| 2 | 2 | 2 | 2023-04-25 | 13:00:00 |
| 3 | 3 | 3 | 2023-04-25 | 13:15:00 |
| 4 | 4 | 1 | 2023-04-25 | 13:20:00 |
| 5 | 2 | 2 | 2023-04-25 | 16:10:00 |
| 6 | 2 | 3 | 2023-04-25 | 18:20:00 |
| 7 | 2 | 1 | 2023-04-25 | 19:20:00 |
| 8 | 2 | 2 | 2023-04-25 | 22:30:00 |
| 9 | 2 | 3 | 2023-04-25 | 22:50:00 |

## Normalization

### 1NF

The schema satisfies 1NF because every table has atomic values. For example, each show timing is stored as one row in the `shows` table instead of storing multiple timings in a single column.

### 2NF

The schema satisfies 2NF because all tables use single-column primary keys, and every non-key attribute depends on the whole primary key. For example, `screen_name` depends on `screen_id`, and `start_time` depends on `show_id`.

### 3NF

The schema satisfies 3NF because non-key attributes do not depend on other non-key attributes. Theatre details are stored only in `theatres`, movie details are stored only in `movies`, and show rows store references instead of repeating theatre or movie information.

### BCNF

The schema satisfies BCNF because the meaningful functional dependencies have candidate keys as their determinants.

For example:

- `theatre_id` determines the theatre attributes.
- `screen_id` determines the screen attributes.
- `movie_id` determines the movie attributes.
- `show_id` determines the details of a show.

In the `shows` table, `(screen_id, show_date, start_time)` is also a candidate key because the unique constraint ensures that this combination identifies at most one show.

Therefore, the determinants used by the schema are candidate keys, satisfying BCNF.

## Unique Constraint on Screen, Date and Time

The `shows` table has this constraint:

```sql
UNIQUE (screen_id, show_date, start_time)
```

This prevents scheduling two shows on the same screen at exactly the same date and start time. It allows different screens to have shows at the same time, and it allows the same screen to have shows at different times.

## P2 Query Explanation

The P2 query lists all shows for a selected theatre and date. It joins:

- `shows` to get the schedule
- `movies` to get movie name, language, and format
- `screens` to connect each show to a theatre
- `theatres` to filter by selected theatre

It filters by `theatre_id` and `show_date`, then orders results by movie name and show time.

## Running the SQL in MySQL

From the repository root, run:

```bash
mysql -u root -p < bookmyshow-db-design/schema.sql
mysql -u root -p < bookmyshow-db-design/queries.sql
```

You can also open MySQL first and run the files from inside the MySQL shell:

```sql
SOURCE bookmyshow-db-design/schema.sql;
SOURCE bookmyshow-db-design/queries.sql;
```

## Verification

The SQL files were tested locally using MySQL 8.0.46.

The schema was created successfully, the sample data was inserted without errors, and the P2 query returned 9 show records for the selected theatre and date.

Tested with:

```sql
SOURCE C:/Airtribe/BackendJavaTrack_BEL_C19/bookmyshow-db-design/schema.sql;
SOURCE C:/Airtribe/BackendJavaTrack_BEL_C19/bookmyshow-db-design/queries.sql;
```

```text
mysql> SOURCE C:/Airtribe/BackendJavaTrack_BEL_C19/bookmyshow-db-design/schema.sql;
Query OK, 1 row affected (0.01 sec)

Database changed
Query OK, 0 rows affected, 1 warning (0.00 sec)

Query OK, 0 rows affected, 1 warning (0.00 sec)

Query OK, 0 rows affected, 1 warning (0.00 sec)

Query OK, 0 rows affected, 1 warning (0.00 sec)

Query OK, 0 rows affected (0.02 sec)

Query OK, 0 rows affected (0.04 sec)

Query OK, 0 rows affected (0.01 sec)

Query OK, 0 rows affected (0.04 sec)

Query OK, 1 row affected (0.01 sec)

Query OK, 3 rows affected (0.00 sec)
Records: 3  Duplicates: 0  Warnings: 0

Query OK, 4 rows affected (0.00 sec)
Records: 4  Duplicates: 0  Warnings: 0

Query OK, 9 rows affected (0.00 sec)
Records: 9  Duplicates: 0  Warnings: 0

mysql> SOURCE C:/Airtribe/BackendJavaTrack_BEL_C19/bookmyshow-db-design/queries.sql;
Database changed
+---------------------------+----------+--------+-----------+
| movie_name                | language | format | show_time |
+---------------------------+----------+--------+-----------+
| Avatar: The Way of Water  | English  | 3D     | 01:20 PM  |
| Dasara                    | Telugu   | 2D     | 12:15 PM  |
| Kisi Ka Bhai Kisi Ki Jaan | Hindi    | 2D     | 01:00 PM  |
| Kisi Ka Bhai Kisi Ki Jaan | Hindi    | 2D     | 04:10 PM  |
| Kisi Ka Bhai Kisi Ki Jaan | Hindi    | 2D     | 06:20 PM  |
| Kisi Ka Bhai Kisi Ki Jaan | Hindi    | 2D     | 07:20 PM  |
| Kisi Ka Bhai Kisi Ki Jaan | Hindi    | 2D     | 10:30 PM  |
| Kisi Ka Bhai Kisi Ki Jaan | Hindi    | 2D     | 10:50 PM  |
| Tu Jhoothi Main Makkaar   | Hindi    | 2D     | 01:15 PM  |
+---------------------------+----------+--------+-----------+
9 rows in set (0.00 sec)
```
