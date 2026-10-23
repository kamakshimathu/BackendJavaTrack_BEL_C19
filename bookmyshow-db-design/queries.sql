USE bookmyshow;

-- P2: List all shows on a given date at a given theatre,
-- along with their respective show timings.
--
-- Example:
-- theatre_id = 1
-- show_date = '2023-04-25'

SELECT
    m.title AS movie_name,
    m.language,
    m.format,
    TIME_FORMAT(s.start_time, '%h:%i %p') AS show_time
FROM shows s
JOIN movies m
    ON s.movie_id = m.movie_id
JOIN screens sc
    ON s.screen_id = sc.screen_id
JOIN theatres t
    ON sc.theatre_id = t.theatre_id
WHERE t.theatre_id = 1
  AND s.show_date = '2023-04-25'
ORDER BY
    m.title,
    s.start_time;
