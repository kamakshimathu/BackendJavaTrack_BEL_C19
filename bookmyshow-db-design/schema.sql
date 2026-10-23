CREATE DATABASE IF NOT EXISTS bookmyshow;

USE bookmyshow;

DROP TABLE IF EXISTS shows;
DROP TABLE IF EXISTS movies;
DROP TABLE IF EXISTS screens;
DROP TABLE IF EXISTS theatres;

CREATE TABLE theatres (
    theatre_id INT AUTO_INCREMENT PRIMARY KEY,
    theatre_name VARCHAR(150) NOT NULL,
    location VARCHAR(150) NOT NULL
);

CREATE TABLE screens (
    screen_id INT AUTO_INCREMENT PRIMARY KEY,
    theatre_id INT NOT NULL,
    screen_name VARCHAR(50) NOT NULL,
    CONSTRAINT fk_screens_theatre
        FOREIGN KEY (theatre_id)
        REFERENCES theatres(theatre_id)
);

CREATE TABLE movies (
    movie_id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    language VARCHAR(50) NOT NULL,
    format VARCHAR(20) NOT NULL,
    certificate VARCHAR(10) NOT NULL
);

CREATE TABLE shows (
    show_id INT AUTO_INCREMENT PRIMARY KEY,
    movie_id INT NOT NULL,
    screen_id INT NOT NULL,
    show_date DATE NOT NULL,
    start_time TIME NOT NULL,
    CONSTRAINT fk_shows_movie
        FOREIGN KEY (movie_id)
        REFERENCES movies(movie_id),
    CONSTRAINT fk_shows_screen
        FOREIGN KEY (screen_id)
        REFERENCES screens(screen_id),
    CONSTRAINT uq_shows_screen_date_time
        UNIQUE (screen_id, show_date, start_time)
);

INSERT INTO theatres (theatre_name, location) VALUES
('PVR Nexus Forum', 'Koramangala, Bengaluru');

INSERT INTO screens (theatre_id, screen_name) VALUES
(1, 'Screen 1'),
(1, 'Screen 2'),
(1, 'Screen 3');

INSERT INTO movies (title, language, format, certificate) VALUES
('Dasara', 'Telugu', '2D', 'UA'),
('Kisi Ka Bhai Kisi Ki Jaan', 'Hindi', '2D', 'UA'),
('Tu Jhoothi Main Makkaar', 'Hindi', '2D', 'UA'),
('Avatar: The Way of Water', 'English', '3D', 'UA');

INSERT INTO shows (movie_id, screen_id, show_date, start_time) VALUES
(1, 1, '2023-04-25', '12:15:00'),
(2, 2, '2023-04-25', '13:00:00'),
(3, 3, '2023-04-25', '13:15:00'),
(4, 1, '2023-04-25', '13:20:00'),
(2, 2, '2023-04-25', '16:10:00'),
(2, 3, '2023-04-25', '18:20:00'),
(2, 1, '2023-04-25', '19:20:00'),
(2, 2, '2023-04-25', '22:30:00'),
(2, 3, '2023-04-25', '22:50:00');
