use chesskers_engine::cli;
use std::io::{self, Read};
use std::process;

fn read_stdin() -> String {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .unwrap_or_else(|e| {
            eprintln!("{e}");
            process::exit(1);
        });
    input
}

fn usage() -> ! {
    eprintln!("usage: chesskers-engine <legal-moves|apply-move|is-terminal|play-random> [--seed N]");
    process::exit(1);
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        usage();
    };

    let mut seed: Option<u64> = None;
    if command == "play-random" {
        while let Some(arg) = args.next() {
            if arg == "--seed" {
                let Some(value) = args.next() else {
                    eprintln!("--seed requires a value");
                    process::exit(1);
                };
                seed = Some(value.parse().unwrap_or_else(|_| {
                    eprintln!("invalid --seed value: {value}");
                    process::exit(1);
                }));
            } else {
                eprintln!("unknown flag: {arg}");
                process::exit(1);
            }
        }
        if seed.is_none() {
            seed = Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos() as u64)
                    .unwrap_or(0),
            );
        }
    } else if args.next().is_some() {
        usage();
    }

    if matches!(
        command.as_str(),
        "legal-moves" | "apply-move" | "is-terminal" | "play-random"
    ) {
        let input = read_stdin();
        match cli::run_with_seed(&command, &input, seed) {
            Ok(json) => println!("{json}"),
            Err(err) => {
                println!(
                    "{}",
                    serde_json::to_string(&err).unwrap_or_else(|_| {
                        r#"{"error":"serialization failed"}"#.to_string()
                    })
                );
                process::exit(1);
            }
        }
    } else {
        eprintln!("unknown command: {command}");
        process::exit(1);
    }
}
